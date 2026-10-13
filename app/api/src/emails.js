// Email content. Each builder returns { to, subject, text, html }.

const BRAND = 'Tasklane';

export function buildPasswordResetEmail(user, link, ttlMinutes) {
  return {
    to: user.email,
    subject: `Reset your ${BRAND} password`,
    text: [
      `Hi ${user.name},`,
      '',
      `Someone asked to reset the password for your ${BRAND} account. If it was you, open this link within ${ttlMinutes} minutes:`,
      '',
      link,
      '',
      "If it wasn't you, ignore this email; your password stays the same.",
    ].join('\n'),
    html: layout(`<p>Hi ${escapeHtml(user.name)},</p>
<p>Someone asked to reset the password for your ${BRAND} account. If it was you, use the button below within ${ttlMinutes} minutes.</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none">Choose a new password</a></p>
<p style="color:#64748b">If it wasn't you, ignore this email; your password stays the same.</p>`),
  };
}

export function buildReminderEmail(task, link, when) {
  return {
    to: task.email,
    subject: `Reminder: "${task.title}" is ${when}`,
    text: [
      `Hi ${task.userName},`,
      '',
      `"${task.title}" on the board "${task.boardName}" is ${when} (${task.dueDate}).`,
      '',
      `Open the task: ${link}`,
    ].join('\n'),
    html: layout(`<p>Hi ${escapeHtml(task.userName)},</p>
<p><strong>${escapeHtml(task.title)}</strong> on the board <em>${escapeHtml(task.boardName)}</em> is ${when} (${task.dueDate}).</p>
<p><a href="${escapeHtml(link)}">Open the task in ${BRAND}</a></p>`),
  };
}

export function buildInviteEmail({ email, inviterName, workspaceName, role }, link, ttlDays) {
  const article = role === 'owner' ? 'an' : 'a';
  return {
    to: email,
    subject: `${inviterName} invited you to ${workspaceName} on ${BRAND}`,
    text: [
      `${inviterName} invited you to join the workspace "${workspaceName}" on ${BRAND} as ${article} ${role}.`,
      '',
      `Accept the invitation (valid for ${ttlDays} days):`,
      link,
    ].join('\n'),
    html: layout(`<p><strong>${escapeHtml(inviterName)}</strong> invited you to join the workspace <strong>${escapeHtml(workspaceName)}</strong> on ${BRAND} as ${article} ${role}.</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none">Accept invitation</a></p>
<p style="color:#64748b">The link works for ${ttlDays} days.</p>`),
  };
}

function layout(body) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#0f172a;max-width:520px">
<p style="font-weight:bold;font-size:18px;color:#4f46e5">${BRAND}</p>
${body}
</div>`;
}

export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}
