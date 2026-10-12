import pino from 'pino';
import { config } from './config.js';
import { createDb, waitForDb } from './db.js';
import { migrate } from './migrate.js';
import { createTaskRepo } from './repo.js';
import { createApp } from './app.js';

const logger = pino({ level: config.logLevel });
const db = createDb(config.databaseUrl);

await waitForDb(db, logger);
await migrate(db.pool, logger);

const app = createApp({ repo: createTaskRepo(db), ping: db.ping, logger });
const server = app.listen(config.port, () => logger.info({ port: config.port }, 'api listening'));

// Finish in-flight requests on SIGTERM so rolling deploys don't drop traffic.
function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
