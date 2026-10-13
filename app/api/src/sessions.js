import { createHash, randomBytes } from 'node:crypto';

const DAY = 24 * 60 * 60;

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

// Only a hash of the token is stored, so a copy of Redis doesn't contain usable sessions.
const keyFor = (token) => `session:${hashToken(token)}`;
// Each user's session keys, so a password change can sign them out everywhere.
const userSetFor = (userId) => `user-sessions:${userId}`;

export function createSessionStore(redis, { ttlSeconds = 7 * DAY } = {}) {
  return {
    ttlSeconds,
    async create(userId) {
      const token = newToken();
      const key = keyFor(token);
      await redis
        .multi()
        .set(key, String(userId), 'EX', ttlSeconds)
        .sadd(userSetFor(userId), key)
        .expire(userSetFor(userId), ttlSeconds)
        .exec();
      return token;
    },
    // Sliding expiry: each authenticated request pushes the expiry out again.
    async get(token) {
      if (!token) return null;
      const userId = await redis.getex(keyFor(token), 'EX', ttlSeconds);
      return userId ? Number(userId) : null;
    },
    async destroy(token) {
      if (!token) return;
      const key = keyFor(token);
      const userId = await redis.get(key);
      await redis.del(key);
      if (userId) await redis.srem(userSetFor(userId), key);
    },
    // Signs the user out of every session, optionally keeping the current one.
    async destroyAll(userId, { except } = {}) {
      const keep = except ? keyFor(except) : null;
      const keys = (await redis.smembers(userSetFor(userId))).filter((key) => key !== keep);
      if (keys.length) await redis.del(...keys);
      await redis.del(userSetFor(userId));
      if (keep) await redis.multi().sadd(userSetFor(userId), keep).expire(userSetFor(userId), ttlSeconds).exec();
    },
  };
}

// Fixed-window counter: at most `limit` attempts per key per window.
export function createRateLimiter(redis) {
  return {
    async hit(key, { limit, windowSeconds }) {
      const redisKey = `ratelimit:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) await redis.expire(redisKey, windowSeconds);
      return count <= limit;
    },
    async reset(key) {
      await redis.del(`ratelimit:${key}`);
    },
  };
}
