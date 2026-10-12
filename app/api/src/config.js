const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set in production');
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // The fallback only exists for local development against compose.dev.yml.
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://taskboard:taskboard@localhost:5432/taskboard',
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
