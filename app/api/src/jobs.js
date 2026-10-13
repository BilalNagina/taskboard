// Background job handlers, keyed by job name. The worker process runs these.
import { buildPasswordResetEmail } from './emails.js';
import { RESET_TTL_MINUTES } from './passwords.js';
import { scanDueTasks, sendReminder } from './reminders.js';

export const resetLink = (appUrl, token) => `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;

export async function sendPasswordReset({ repo, mailer, appUrl }, { userId, token }) {
  const user = await repo.findUserById(userId);
  if (!user) return { sent: false };
  await mailer.send(buildPasswordResetEmail(user, resetLink(appUrl, token), RESET_TTL_MINUTES));
  return { sent: true };
}

export function createJobHandlers({ repo, mailer, queue, appUrl }) {
  return {
    scan: () => scanDueTasks({ repo, queue }),
    email: (data) => sendReminder({ repo, mailer, appUrl }, data),
    'password-reset': (data) => sendPasswordReset({ repo, mailer, appUrl }, data),
  };
}
