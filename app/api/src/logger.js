import pino from 'pino';

// Request logs include headers, and some headers are credentials: the session cookie (in
// requests, and set on sign-in), an Authorization header, and the payment provider's
// webhook signature. They're replaced before anything is written, so logs can be read
// and shipped without handing out sessions.
export const REDACTED_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["paddle-signature"]',
  'res.headers["set-cookie"]',
];

export function createLogger(level = 'info', destination) {
  const options = { level, redact: { paths: REDACTED_PATHS, censor: '[redacted]' } };
  return destination ? pino(options, destination) : pino(options);
}
