// A task in a list outside its board (dashboard, search, calendar agenda). Opens the
// task on its board.
import { Link } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { Avatar } from '../../components/ui.jsx';
import { dueInfo } from '../../lib/format.js';
import { PriorityIcon } from './board/Card.jsx';

export function TaskRowLink({ task, members, highlight, showBoard = true }) {
  const due = dueInfo(task.dueDate, task.done);
  const assignees = task.assigneeIds.map((id) => members.get(id)).filter(Boolean);
  return (
    <Link to={`/app/boards/${task.boardId}?task=${task.id}`} className={`task-link ${task.done ? 'is-done' : ''}`}>
      <span className={`task-link-check ${task.done ? 'done' : ''}`}>{task.done && <Icon name="check" size={11} strokeWidth={3} />}</span>
      <span className="task-link-main">
        <span className="task-link-title">{highlight ? highlightText(task.title, highlight) : task.title}</span>
        <span className="task-link-meta">
          {showBoard && (
            <span className="faint">
              {task.boardName} · {task.columnName}
            </span>
          )}
          {task.labels.slice(0, 3).map((l) => (
            <span key={l.id} className={`label tone-${l.color}`}>
              {l.name}
            </span>
          ))}
        </span>
      </span>
      {task.priority !== 'none' && (
        <span className={`prio prio-${task.priority}`} title={`${task.priority} priority`}>
          <PriorityIcon value={task.priority} />
        </span>
      )}
      {due && (
        <span className={`badge ${due.tone}`}>
          <Icon name="calendar" size={11} /> {due.label}
        </span>
      )}
      {assignees.length > 0 && (
        <span className="avatar-stack">
          {assignees.slice(0, 3).map((m) => (
            <Avatar key={m.id} name={m.name} seed={m.email} url={m.avatarUrl} size="sm" />
          ))}
        </span>
      )}
    </Link>
  );
}

// Wraps the parts of `text` that start a word matching the search, case-insensitively.
function highlightText(text, query) {
  const words = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(Boolean);
  if (!words.length) return text;
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'giu');
  return text.split(pattern).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}
