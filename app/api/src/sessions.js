import { createHash, randomBytes } from 'node:crypto';

const DAY = 24 * 60 * 60;

// Only a hash of the token is stored, so a copy of Redis doesn't contain usable sessions.
const keyFor = (token) => `session:${createHash('sha256').update(token).digest('hex')}`;

export function createSessionStore(redis, { ttlSeconds = 7 * DAY } = {}) {
  return {
    ttlSeconds,
    async create(userId) {
      const token = randomBytes(32).toString('base64url');
      await redis.set(keyFor(token), String(userId), 'EX', ttlSeconds);
      return token;
    },
    // Sliding expiry: each authenticated request pushes the expiry out again.
    async get(token) {
      if (!token) return null;
      const userId = await redis.getex(keyFor(token), 'EX', ttlSeconds);
      return userId ? Number(userId) : null;
    },
    async destroy(token) {
      if (token) await redis.del(keyFor(token));
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
