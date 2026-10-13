// Reminder emails, run by the worker:
//   1. A scheduled "scan" job finds open tasks due soon and queues one "email" job each.
//   2. Each "email" job re-checks the task, sends the email and records that it was sent.
// The job id includes the due date, so a task already queued isn't queued twice, and
// moving the due date queues a fresh reminder.
import { buildReminderEmail } from './emails.js';

export const reminderJobId = (task) => `reminder-${task.id}-${task.dueDate}`;

export async function scanDueTasks({ repo, queue }) {
  const tasks = await repo.tasksNeedingReminder();
  if (tasks.length > 0) {
    await queue.addBulk(
      tasks.map((task) => ({
        name: 'email',
        data: { taskId: task.id, dueDate: task.dueDate },
        opts: { jobId: reminderJobId(task) },
      })),
    );
  }
  return { queued: tasks.length };
}

// At-least-once: if the process dies after sending but before recording it, the retry
// sends a second email. That beats the alternative of losing the reminder.
export async function sendReminder({ repo, mailer, appUrl }, { taskId, dueDate }, today = todayUtc()) {
  const task = await repo.reminderDetails(taskId, dueDate);
  if (!task) return { sent: false };
  const when = describeDue(task.dueDate, today);
  const link = `${appUrl}/app/boards/${task.boardId}?task=${task.id}`;
  for (const person of task.recipients) {
    await mailer.send(buildReminderEmail({ ...task, email: person.email, userName: person.name }, link, when));
  }
  await repo.markReminded(taskId, dueDate);
  return { sent: task.recipients.length > 0 };
}

export function describeDue(dueDate, today) {
  const days = Math.round((Date.parse(dueDate) - Date.parse(today)) / 86_400_000);
  if (days < 0) return 'overdue';
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}
