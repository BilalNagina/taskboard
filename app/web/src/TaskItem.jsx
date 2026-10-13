import { useRef, useState } from 'react';
import { api } from './api.js';

export default function TaskItem({ task, onUpdate, onDelete, onUpload, onDeleteAttachment }) {
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef(null);
  const due = dueStatus(task);

  async function pickFile(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    await onUpload(file);
    setUploading(false);
  }

  return (
    <li className={`task ${task.done ? 'done' : ''}`}>
      <div className="task-row">
        <label className="task-title">
          <input type="checkbox" checked={task.done} onChange={() => onUpdate({ done: !task.done })} />
          <span>{task.title}</span>
        </label>
        <div className="task-meta">
          {due && <span className={`badge ${due.tone}`}>{due.label}</span>}
          <button
            className={`ghost files-toggle ${expanded ? 'active' : ''}`}
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label={`Details and files for ${task.title}`}
          >
            📎 {task.attachments.length || ''}
          </button>
          <button className="ghost danger" onClick={onDelete} aria-label={`Delete ${task.title}`}>
            ✕
          </button>
        </div>
      </div>

      {expanded && (
        <div className="task-details">
          <label className="inline">
            Due date
            <input
              type="date"
              value={task.dueDate ?? ''}
              onChange={(e) => onUpdate({ dueDate: e.target.value || null })}
            />
          </label>

          <ul className="files">
            {task.attachments.map((file) => (
              <li key={file.id}>
                <a href={api.downloadUrl(file.id)}>{file.filename}</a>
                <span className="muted">{formatSize(file.size)}</span>
                <button className="ghost danger" onClick={() => onDeleteAttachment(file)} aria-label={`Remove ${file.filename}`}>
                  ✕
                </button>
              </li>
            ))}
          </ul>

          <input ref={fileInput} type="file" hidden onChange={pickFile} />
          <button className="secondary" onClick={() => fileInput.current.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : 'Attach a file'}
          </button>
          <span className="hint">Up to 10 MB, stored privately in S3</span>
        </div>
      )}
    </li>
  );
}

function localToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function dueStatus(task) {
  if (!task.dueDate) return null;
  const days = Math.round((Date.parse(task.dueDate) - Date.parse(localToday())) / 86_400_000);
  if (task.done) return { label: formatDate(task.dueDate), tone: 'quiet' };
  if (days < 0) return { label: 'Overdue', tone: 'red' };
  if (days === 0) return { label: 'Due today', tone: 'amber' };
  if (days === 1) return { label: 'Tomorrow', tone: 'amber' };
  return { label: formatDate(task.dueDate), tone: 'quiet' };
}

function formatDate(isoDate) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
