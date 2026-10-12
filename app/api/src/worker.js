// Background worker: sends reminder emails for tasks that are due soon.
// Runs from the same image as the API with a different command (node src/worker.js).
import http from 'node:http';
import { Queue, Worker } from 'bullmq';
import pino from 'pino';
import client from 'prom-client';
import { config } from './config.js';
import { createDb, waitForDb } from './db.js';
import { createMailer } from './mailer.js';
import { createRepo } from './repo.js';
import { QUEUE_NAME, scanDueTasks, sendReminder } from './reminders.js';

const logger = pino({ level: config.logLevel });
const db = createDb(config.databaseUrl);
await waitForDb(db, logger);

const repo = createRepo(db);
const mailer = createMailer(config.mail, logger);
// BullMQ needs maxRetriesPerRequest: null so its blocking commands wait out Redis restarts.
const connection = { url: config.redisUrl, maxRetriesPerRequest: null };

const queue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 24 * 3600 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});
// Idempotent: every worker replica upserts the same schedule, and only one scan runs.
await queue.upsertJobScheduler('scan-due-tasks', { every: config.reminderScanMs }, { name: 'scan' });

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });
const jobsTotal = new client.Counter({
  name: 'reminder_jobs_total',
  help: 'Reminder queue jobs processed',
  labelNames: ['name', 'result'],
  registers: [registry],
});

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name === 'scan') return scanDueTasks({ repo, queue });
    if (job.name === 'email') return sendReminder({ repo, mailer, appUrl: config.appUrl }, job.data);
    throw new Error(`unknown job ${job.name}`);
  },
  { connection, concurrency: 5 },
);

worker.on('completed', (job, result) => {
  jobsTotal.inc({ name: job.name, result: 'completed' });
  if (job.name === 'email' || result?.queued) logger.info({ job: job.name, id: job.id, result }, 'job completed');
});
worker.on('failed', (job, err) => {
  jobsTotal.inc({ name: job?.name ?? 'unknown', result: 'failed' });
  logger.error({ job: job?.name, id: job?.id, attempt: job?.attemptsMade, err: err.message }, 'job failed');
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
  await Promise.allSettled([queue.close(), db.close(), mailer.close()]);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
