// Phase 1 board view: a list with due dates and attachments. Phase 2 turns this into a
// drag-and-drop board with columns, and opens task details in a side panel.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/Toaster.jsx';
import { ConfirmDialog, Dropdown, EmptyState, PromptDialog } from '../../components/ui.jsx';
import { api, MAX_UPLOAD_BYTES } from '../../lib/api.js';
import { daysUntil, formatDate, formatSize } from '../../lib/format.js';
import { keys, useBoard, useTasks, useWorkspaces } from '../../lib/queries.js';
import { useCurrentWorkspace } from './AppLayout.jsx';

export default function BoardPage() {
  const boardId = Number(useParams().boardId);
  const { data: board, isPending, error } = useBoard(boardId);
  const { data: tasks = [] } = useTasks(boardId);
  const { data: workspaces = [] } = useWorkspaces();
  const { setWorkspaceId } = useCurrentWorkspace();
  const [dialog, setDialog] = useState(null);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (board) setWorkspaceId(board.workspaceId);
  }, [board?.workspaceId]);

  if (isPending) return <div className="page-loading"><span className="spinner" /></div>;
  if (error) {
    return (
      <div className="page">
        <EmptyState icon="board" title="Board not found" action={<Link to="/app" className="btn btn-primary">Back to my boards</Link>}>
          It may have been deleted, or you don&apos;t have access to it.
        </EmptyState>
      </div>
    );
  }

  const workspace = workspaces.find((w) => w.id === board.workspaceId);
  const canEdit = board.role !== 'viewer';
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.tasks(boardId) }),
      client.invalidateQueries({ queryKey: keys.board(boardId) }),
      client.invalidateQueries({ queryKey: keys.boards(board.workspaceId) }),
    ]);

  async function run(action, success) {
    try {
      await action();
      await refresh();
      if (success) toast(success, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const addTask = (event) => {
    event.preventDefault();
    run(async () => {
      await api.createTask(boardId, { title, dueDate: dueDate || null });
      setTitle('');
      setDueDate('');
    });
  };

  return (
    <div className="page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={`/app/w/${board.workspaceId}`}>{workspace?.name ?? 'Workspace'}</Link>
        <Icon name="chevronRight" size={14} />
        <span>{board.name}</span>
      </nav>
      <header className="page-head">
        <div>
          <h1>{board.name}</h1>
          <p className="muted page-sub">
            {open.length} open · {done.length} done
          </p>
        </div>
        {canEdit && (
          <Dropdown
            align="right"
            trigger={({ toggle, open: isOpen }) => (
              <button className="btn btn-secondary" onClick={toggle} aria-expanded={isOpen} aria-label="Board options">
                <Icon name="more" size={18} />
              </button>
            )}
          >
            <button className="menu-item" onClick={() => setDialog('rename')}>
              <Icon name="edit" size={16} /> Rename board
            </button>
            {board.role === 'owner' && (
              <button className="menu-item danger" onClick={() => setDialog('delete')}>
                <Icon name="trash" size={16} /> Delete board
              </button>
            )}
          </Dropdown>
        )}
      </header>

      {!canEdit && <p className="notice"><Icon name="eye" size={16} /> You have view-only access to this board.</p>}

      <section className="card list-card">
        {canEdit && (
          <form onSubmit={addTask} className="add-task">
            <Icon name="plus" size={18} className="add-task-icon" />
            <input className="add-task-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" maxLength={200} aria-label="New task" />
            <input type="date" className="input input-sm" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date (optional)" title="Due date (optional)" />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!title.trim()}>
              Add
            </button>
          </form>
        )}

        {tasks.length === 0 ? (
          <EmptyState icon="check" title="Nothing here yet">
            {canEdit ? 'Add the first task above.' : 'Tasks added to this board will appear here.'}
          </EmptyState>
        ) : (
          <ul className="task-list">
            {[...open, ...done].map((task) => (
              <TaskRow key={task.id} task={task} canEdit={canEdit} run={run} toast={toast} />
            ))}
          </ul>
        )}
      </section>

      {dialog === 'rename' && (
        <PromptDialog
          title="Rename board"
          label="Board name"
          initial={board.name}
          submitLabel="Save"
          onSubmit={async (name) => {
            await api.renameBoard(boardId, name);
            await refresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title={`Delete "${board.name}"?`}
          description="All of its tasks and attached files are deleted too. This can't be undone."
          confirmLabel="Delete board"
          danger
          onConfirm={async () => {
            await api.deleteBoard(boardId);
            await client.invalidateQueries({ queryKey: keys.boards(board.workspaceId) });
            toast('Board deleted', 'success');
            navigate(`/app/w/${board.workspaceId}`);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function TaskRow({ task, canEdit, run, toast }) {
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef(null);
  const due = dueBadge(task);

  async function pickFile(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) return toast(`"${file.name}" is larger than 10 MB`, 'error');
    setUploading(true);
    await run(() => api.upload(task.id, file), 'File attached');
    setUploading(false);
  }

  return (
    <li className={`task-row ${task.done ? 'is-done' : ''} ${expanded ? 'is-open' : ''}`}>
      <div className="task-line">
        <label className="task-check">
          <input type="checkbox" checked={task.done} disabled={!canEdit} onChange={() => run(() => api.updateTask(task.id, { done: !task.done }))} />
          <span className="checkmark"><Icon name="check" size={12} strokeWidth={3} /></span>
          <span className="task-title">{task.title}</span>
        </label>
        <div className="task-meta">
          {due && <span className={`badge ${due.tone}`}><Icon name="calendar" size={12} /> {due.label}</span>}
          <button className={`icon-btn ${expanded ? 'active' : ''}`} onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-label={`Details for ${task.title}`}>
            <Icon name="clip" size={16} />
            {task.attachments.length > 0 && <span className="icon-count">{task.attachments.length}</span>}
          </button>
          {canEdit && (
            <button className="icon-btn danger" onClick={() => run(() => api.deleteTask(task.id), 'Task deleted')} aria-label={`Delete ${task.title}`}>
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="task-details">
          <label className="inline-field">
            <span>Due date</span>
            <input
              type="date"
              className="input input-sm"
              value={task.dueDate ?? ''}
              disabled={!canEdit}
              onChange={(e) => run(() => api.updateTask(task.id, { dueDate: e.target.value || null }))}
            />
          </label>
          <div className="files">
            {task.attachments.map((file) => (
              <div key={file.id} className="file-chip">
                <Icon name="clip" size={14} />
                <a href={api.downloadUrl(file.id)}>{file.filename}</a>
                <span className="faint">{formatSize(file.size)}</span>
                {canEdit && (
                  <button className="icon-btn danger" style={{ width: 24, height: 24 }} onClick={() => run(() => api.deleteAttachment(file.id), 'File removed')} aria-label={`Remove ${file.filename}`}>
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            ))}
            {canEdit && (
              <>
                <input ref={fileInput} type="file" hidden onChange={pickFile} />
                <button className="btn btn-secondary btn-sm" onClick={() => fileInput.current.click()} disabled={uploading}>
                  {uploading ? 'Uploading…' : 'Attach a file'}
                </button>
              </>
            )}
            {!canEdit && task.attachments.length === 0 && <span className="faint small">No files</span>}
          </div>
        </div>
      )}
    </li>
  );
}

function dueBadge(task) {
  if (!task.dueDate) return null;
  const days = daysUntil(task.dueDate);
  if (task.done) return { label: formatDate(task.dueDate), tone: '' };
  if (days < 0) return { label: 'Overdue', tone: 'badge-danger' };
  if (days === 0) return { label: 'Today', tone: 'badge-warning' };
  if (days === 1) return { label: 'Tomorrow', tone: 'badge-warning' };
  return { label: formatDate(task.dueDate), tone: '' };
}
