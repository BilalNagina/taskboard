import { Avatar } from '../../../components/ui.jsx';
import { formatDate, priorityInfo, repeatLabel, timeAgo } from '../../../lib/format.js';

// Turns an activity entry into a sentence. `inTask` drops the task name when the feed is
// already inside that task's panel.
export function describe(entry, inTask = false) {
  const d = entry.data ?? {};
  const task = inTask ? 'this task' : `“${entry.taskTitle ?? d.title ?? 'a task'}”`;
  switch (entry.type) {
    case 'task.created':
      return inTask ? 'created this task' : `created ${task}`;
    case 'task.moved':
      return `moved ${task} from ${d.from ?? 'a column'} to ${d.to}`;
    case 'task.completed':
      return `completed ${task}`;
    case 'task.reopened':
      return `reopened ${task}`;
    case 'task.renamed':
      return `renamed “${d.from}” to “${d.to}”`;
    case 'task.assigned':
      return `assigned ${d.names?.join(', ') || 'someone'} to ${task}`;
    case 'task.due_changed':
      return d.dueDate ? `set ${task} due ${formatDate(d.dueDate)}` : `removed the due date from ${task}`;
    case 'task.priority_changed':
      return `set the priority of ${task} to ${priorityInfo(d.priority).label.toLowerCase()}`;
    case 'task.repeat_changed':
      return d.repeat ? `set ${task} to repeat ${repeatLabel(d.repeat).toLowerCase()}` : `stopped ${task} repeating`;
    case 'task.recurred':
      return `${inTask ? 'created this task' : `created the next “${d.title}”`} as a repeat, due ${formatDate(d.dueDate)}`;
    case 'task.description_changed':
      return `updated the description of ${task}`;
    case 'task.deleted':
      return `deleted “${d.title}”`;
    case 'comment.added':
      return `commented on ${task}`;
    case 'attachment.added':
      return `attached ${d.filename} to ${task}`;
    case 'board.created':
      return `created the board ${d.name}`;
    case 'board.deleted':
      return `deleted the board ${d.name}`;
    case 'workspace.renamed':
      return `renamed the workspace to “${d.to}”`;
    // With `status`, the change came from the subscription (checkout, cancelling, a trial).
    case 'workspace.plan_changed':
      if (d.status && d.to === 'free') return `ended the ${planName(d.from)} subscription; the workspace is back on Free`;
      if (d.status === 'trialing') return `started a free trial of ${planName(d.to)}`;
      return `switched the workspace to the ${planName(d.to)} plan`;
    case 'workspace.seats_changed':
      return `changed the paid seats from ${d.from} to ${d.to}`;
    case 'member.invited':
      return `invited ${d.email} as ${article(d.role)} ${d.role}`;
    case 'member.joined':
      return `joined as ${article(d.role)} ${d.role}`;
    case 'member.role_changed':
      return `made ${d.name} ${article(d.role)} ${d.role}`;
    case 'member.removed':
      return `removed ${d.name} from the workspace`;
    case 'member.left':
      return 'left the workspace';
    case 'board.renamed':
      return `renamed the board to “${d.to}”`;
    case 'column.created':
      return `added the column ${d.name}`;
    case 'column.renamed':
      return `renamed the column ${d.from} to ${d.to}`;
    case 'column.deleted':
      return `deleted the column ${d.name}`;
    default:
      return entry.type.replace('.', ' ');
  }
}

const article = (role) => (role === 'owner' ? 'an' : 'a');
const planName = (key = '') => key.charAt(0).toUpperCase() + key.slice(1);

export function ActivityList({ entries, inTask, onOpenTask, showBoard = false }) {
  if (!entries?.length) return <p className="faint small">Nothing has happened here yet.</p>;
  return (
    <ol className="activity">
      {entries.map((entry) => (
        <li key={entry.id}>
          <Avatar name={entry.actor.name} seed={entry.actor.email} url={entry.actor.avatarUrl} size="sm" />
          <div>
            <p>
              <b>{entry.actor.name}</b>{' '}
              {onOpenTask && entry.taskId ? (
                <button className="link-inline" onClick={() => onOpenTask(entry.taskId, entry)}>
                  {describe(entry, inTask)}
                </button>
              ) : (
                describe(entry, inTask)
              )}
            </p>
            {entry.type === 'comment.added' && entry.data.excerpt && <p className="activity-quote">{entry.data.excerpt}</p>}
            <time className="faint small" dateTime={entry.createdAt} title={new Date(entry.createdAt).toLocaleString()}>
              {timeAgo(entry.createdAt)}
            </time>
            {showBoard && entry.boardName && <span className="faint small"> · {entry.boardName}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
