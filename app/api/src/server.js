import pino from 'pino';
import { config } from './config.js';
import { createDb, waitForDb } from './db.js';
import { migrate } from './migrate.js';
import { createRedis } from './redis.js';
import { createRepo } from './repo.js';
import { createRateLimiter, createSessionStore } from './sessions.js';
import { createS3Storage } from './storage.js';
import { createApp } from './app.js';

const logger = pino({ level: config.logLevel });
const db = createDb(config.databaseUrl);
const redis = createRedis(config.redisUrl, logger);

await waitForDb(db, logger);
await migrate(db.pool, logger);

const app = createApp({
  repo: createRepo(db),
  sessions: createSessionStore(redis),
  limiter: createRateLimiter(redis),
  storage: createS3Storage(config.s3),
  ping: () => Promise.all([db.ping(), redis.ping()]),
  logger,
  cookieSecure: config.cookieSecure,
});
const server = app.listen(config.port, () => logger.info({ port: config.port }, 'api listening'));

// Finish in-flight requests on SIGTERM so rolling deploys don't drop traffic.
function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await Promise.allSettled([db.close(), redis.quit()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
