// Background worker: reminder emails and password-reset emails, from a Redis job queue.
// Runs from the same image as the API with a different command (node src/worker.js).
import http from 'node:http';
import { Worker } from 'bullmq';
import pino from 'pino';
import client from 'prom-client';
import { config } from './config.js';
import { createRepo } from './data/index.js';
import { createDb, waitForDb } from './db.js';
import { createJobHandlers, resetLink } from './jobs.js';
import { createLivePublisher } from './live.js';
import { createMailer } from './mailer.js';
import { createQueue, QUEUE_NAME, queueConnection } from './queue.js';
import { createRedis } from './redis.js';

const logger = pino({ level: config.logLevel });
const db = createDb(config.databaseUrl);
await waitForDb(db, logger);

const repo = createRepo(db);
const mailer = createMailer(config.mail, logger);
const queue = createQueue(config.redisUrl);
// Idempotent: every worker replica upserts the same schedule, and only one scan runs.
await queue.upsertJobScheduler('scan-due-tasks', { every: config.reminderScanMs }, { name: 'scan' });

// Due-date notifications made here appear in browsers straight away, via the API.
const redis = createRedis(config.redisUrl, logger);
const handlers = createJobHandlers({ repo, mailer, queue, appUrl: config.appUrl, live: createLivePublisher(redis, logger) });

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });
const jobsTotal = new client.Counter({
  name: 'jobs_total',
  help: 'Background jobs processed',
  labelNames: ['name', 'result'],
  registers: [registry],
});

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const handler = handlers[job.name];
    if (!handler) throw new Error(`unknown job ${job.name}`);
    return handler(job.data);
  },
  { connection: queueConnection(config.redisUrl), concurrency: 5 },
);

worker.on('completed', (job, result) => {
  jobsTotal.inc({ name: job.name, result: 'completed' });
  if (job.name !== 'scan' || result?.queued) logger.info({ job: job.name, id: job.id, result }, 'job completed');
});
worker.on('failed', (job, err) => {
  jobsTotal.inc({ name: job?.name ?? 'unknown', result: 'failed' });
  logger.error({ job: job?.name, id: job?.id, attempt: job?.attemptsMade, err: err.message }, 'job failed');
  // Fallback when a reset email can't be delivered (for example to an address SES won't
  // send to yet): the link goes to the server log so an admin can pass it on.
  if (job?.name === 'password-reset' && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    logger.warn(
      { userId: job.data.userId, link: resetLink(config.appUrl, job.data.token) },
      'password reset email could not be sent; share this link with the user (valid 30 minutes)',
    );
  }
});
worker.on('error', (err) => logger.error({ err: err.message }, 'worker error'));

// Internal health and metrics endpoint (not published outside the Docker network).
const health = http.createServer(async (req, res) => {
  if (req.url === '/metrics') {
    res.setHeader('Content-Type', registry.contentType);
    return res.end(await registry.metrics());
  }
  if (req.url === '/healthz') {
    const ok = worker.isRunning();
    res.statusCode = ok ? 200 : 503;
    return res.end(JSON.stringify({ status: ok ? 'ok' : 'stopped' }));
  }
  res.statusCode = 404;
  res.end();
});
health.listen(config.workerPort, () =>
  logger.info({ port: config.workerPort, scanEveryMs: config.reminderScanMs }, 'worker started'),
);

// Let the current job finish before exiting, so a deploy doesn't cut an email in half.
async function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  setTimeout(() => process.exit(1), 20_000).unref();
  health.close();
  await worker.close();
  await Promise.allSettled([queue.close(), db.close(), mailer.close(), redis.quit()]);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
