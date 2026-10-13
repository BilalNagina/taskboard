// Background job handlers, keyed by job name. The worker process runs these.
import { buildInviteEmail, buildPasswordResetEmail } from './emails.js';
import { RESET_TTL_MINUTES } from './passwords.js';
import { scanDueTasks, sendReminder } from './reminders.js';

export const INVITE_TTL_DAYS = 7;

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

export function createJobHandlers({ repo, mailer, queue, appUrl }) {
  const deps = { repo, mailer, appUrl };
  return {
    scan: () => scanDueTasks({ repo, queue }),
    email: (data) => sendReminder(deps, data),
    'password-reset': (data) => sendPasswordReset(deps, data),
    invite: (data) => sendInvite(deps, data),
  };
}
