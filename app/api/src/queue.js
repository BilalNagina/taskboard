import { Queue } from 'bullmq';

// One queue for all background work: reminders, password-reset emails, and later
// notifications and recurring tasks. Jobs are told apart by name.
export const QUEUE_NAME = 'jobs';

// BullMQ needs maxRetriesPerRequest: null so its blocking commands wait out Redis restarts.
export const queueConnection = (redisUrl) => ({ url: redisUrl, maxRetriesPerRequest: null });

export function createQueue(redisUrl) {
  return new Queue(QUEUE_NAME, {
    connection: queueConnection(redisUrl),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
}
