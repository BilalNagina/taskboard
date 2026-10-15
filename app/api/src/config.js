const env = process.env;
const isProduction = env.NODE_ENV === 'production';

if (isProduction) {
  for (const name of ['DATABASE_URL', 'REDIS_URL', 'APP_URL']) {
    if (!env[name]) throw new Error(`${name} must be set in production`);
  }
}

// The fallbacks only exist for local development against compose.dev.yml.
export const config = {
  port: Number(env.PORT ?? 3000),
  workerPort: Number(env.WORKER_PORT ?? 3001),
  databaseUrl: env.DATABASE_URL ?? 'postgres://taskboard:taskboard@localhost:5432/taskboard',
  redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
  appUrl: (env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  logLevel: env.LOG_LEVEL ?? 'info',
  // Session cookies are Secure (HTTPS only) everywhere except local development.
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction,

  s3: {
    bucket: env.S3_BUCKET || 'taskboard-attachments',
    region: env.S3_REGION || 'us-east-1',
    // Set for S3-compatible storage such as MinIO in development; empty means AWS S3.
    endpoint: env.S3_ENDPOINT || undefined,
    accessKeyId: env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY || undefined,
  },

  mail: {
    from: env.MAIL_FROM || 'Taskboard <reminders@localhost>',
    // Without SMTP_HOST, emails are written to the log instead of being sent.
    host: env.SMTP_HOST || undefined,
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER || undefined,
    pass: env.SMTP_PASS || undefined,
  },

  // Paid plans through Paddle. Without PADDLE_API_KEY billing is off and owners switch
  // plans for free. Sandbox unless PADDLE_ENV=production.
  paddle: {
    apiKey: env.PADDLE_API_KEY || undefined,
    webhookSecret: env.PADDLE_WEBHOOK_SECRET || undefined,
    clientToken: env.PADDLE_CLIENT_TOKEN || undefined,
    environment: env.PADDLE_ENV === 'production' ? 'production' : 'sandbox',
  },

  reminderScanMs: Number(env.REMINDER_SCAN_MS ?? 5 * 60_000),
};
