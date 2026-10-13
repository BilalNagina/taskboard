import pino from 'pino';
import { config } from './config.js';
import { createRepo } from './data/index.js';
import { createDb, waitForDb } from './db.js';
import { createApp } from './http/app.js';
import { migrate } from './migrate.js';
import { createQueue } from './queue.js';
import { createRedis } from './redis.js';
import { createRateLimiter, createSessionStore } from './sessions.js';
import { createS3Storage } from './storage.js';

const logger = pino({ level: config.logLevel });
const db = createDb(config.databaseUrl);
const redis = createRedis(config.redisUrl, logger);
const queue = createQueue(config.redisUrl);

await waitForDb(db, logger);
await migrate(db.pool, logger);

const app = createApp({
  repo: createRepo(db),
  sessions: createSessionStore(redis),
  limiter: createRateLimiter(redis),
  storage: createS3Storage(config.s3),
  jobs: { add: (name, data, opts) => queue.add(name, data, opts) },
  ping: () => Promise.all([db.ping(), redis.ping()]),
  logger,
  cookieSecure: config.cookieSecure,
  appUrl: config.appUrl,
});
const server = app.listen(config.port, () => logger.info({ port: config.port }, 'api listening'));

// Finish in-flight requests on SIGTERM so rolling deploys don't drop traffic.
function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await Promise.allSettled([db.close(), redis.quit(), queue.close()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
