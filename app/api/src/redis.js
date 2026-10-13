import { Redis } from 'ioredis';

export function createRedis(url, logger) {
  const redis = new Redis(url, {
    // Fail commands quickly while Redis is down instead of queueing them forever,
    // so /readyz reports the outage rather than hanging.
    maxRetriesPerRequest: 2,
  });
  redis.on('error', (err) => logger?.warn({ err: err.message }, 'redis error'));
  return redis;
}
