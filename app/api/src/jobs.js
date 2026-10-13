// Background job handlers, keyed by job name. The worker process runs these.
import { emailTypesFor } from './data/notifications.js';
import { buildInviteEmail, buildNotificationEmail, buildPasswordResetEmail } from './emails.js';
import { RESET_TTL_MINUTES } from './passwords.js';
import { scanDueTasks, sendReminder } from './reminders.js';

export const INVITE_TTL_DAYS = 7;

// Notification emails wait a couple of minutes: things that happen close together share
// one email, and anything read in the app meanwhile isn't emailed at all. One waiting job
// per person (the job id), so a burst of notifications doesn't queue a burst of emails.
export const NOTIFICATION_EMAIL_DELAY_MS = 2 * 60_000;
export const notificationEmailJob = (userId, suffix = '') => ({
  name: 'notification-email',
  data: { userId },
  opts: {
    jobId: `notification-email-${userId}${suffix}`,
    delay: NOTIFICATION_EMAIL_DELAY_MS,
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: true,
  },
});

export const resetLink = (appUrl, token) => `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
export const inviteLink = (appUrl, token) => `${appUrl}/invite/${encodeURIComponent(token)}`;

export async function sendPasswordReset({ repo, mailer, appUrl }, { userId, token }) {
  const user = await repo.findUserById(userId);
  if (!user) return { sent: false };
  await mailer.send(buildPasswordResetEmail(user, resetLink(appUrl, token), RESET_TTL_MINUTES));
  return { sent: true };
}

export async function sendInvite({ repo, mailer, appUrl }, { inviteId, token }) {
  const invite = await repo.getInvite(inviteId);
  if (!invite) return { sent: false }; // revoked or already accepted
  await mailer.send(
    buildInviteEmail(
      {
        email: invite.email,
        inviterName: invite.invitedBy?.name ?? 'A teammate',
        workspaceName: invite.workspaceName,
        role: invite.role,
      },
      inviteLink(appUrl, token),
      INVITE_TTL_DAYS,
    ),
  );
  return { sent: true };
}

export async function sendNotificationEmail({ repo, mailer, appUrl, queue }, { userId }) {
  const user = await repo.findUserById(userId);
  const types = user ? emailTypesFor(user.notificationPrefs) : [];
  if (!types.length) return { sent: 0 };
  const items = await repo.claimEmailNotifications(userId, types);
  if (items.length) {
    try {
      await mailer.send(buildNotificationEmail(user, items, appUrl));
    } catch (err) {
      await repo.releaseEmailNotifications(items.map((n) => n.id));
      throw err;
    }
  }
  // Something that arrived while this job ran couldn't queue its own (this job held the
  // id), so it gets a follow-up.
  if (queue && (await repo.hasPendingEmail(userId, types))) {
    const job = notificationEmailJob(userId, `-${Date.now()}`);
    await queue.add(job.name, job.data, job.opts);
  }
  return { sent: items.length };
}

export function createJobHandlers({ repo, mailer, queue, appUrl, live }) {
  const deps = { repo, mailer, appUrl, queue, live };
  return {
    scan: () => scanDueTasks({ repo, queue }),
    email: (data) => sendReminder(deps, data),
    'notification-email': (data) => sendNotificationEmail(deps, data),
    'password-reset': (data) => sendPasswordReset(deps, data),
    invite: (data) => sendInvite(deps, data),
  };
}
