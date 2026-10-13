// Side panel with everything about one task. Opens over the board (?task=<id>).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Icon from '../../../components/Icon.jsx';
import { useToast } from '../../../components/Toaster.jsx';
import { Avatar, ConfirmDialog, Dropdown } from '../../../components/ui.jsx';
import { api, MAX_UPLOAD_BYTES } from '../../../lib/api.js';
import { dueInfo, formatSize, timeAgo } from '../../../lib/format.js';
import { keys, useMe, useTask } from '../../../lib/queries.js';
import { ActivityList } from './Activity.jsx';
import { AssigneePicker, LabelPicker, PriorityPicker } from './Pickers.jsx';

export default function TaskPanel({ taskId, board, columns, labels, members, onClose }) {
  const { data: task, isPending, error } = useTask(taskId);
  const { data: me } = useMe();
  const client = useQueryClient();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !document.querySelector('.menu, .dialog') && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.task(taskId) }),
      client.invalidateQueries({ queryKey: keys.boardFull(board.id) }),
      client.invalidateQueries({ queryKey: keys.activity(board.id) }),
    ]);

  async function run(action, success) {
    try {
      const result = await action();
      await refresh();
      if (success) toast(success, 'success');
      return result;
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const update = (changes) => run(() => api.updateTask(taskId, changes));
  const canEdit = task?.role !== 'viewer' && board.role !== 'viewer';

  return (
    <>
      <div className="panel-scrim" onClick={onClose} />
      <aside className="panel" ref={panelRef} role="dialog" aria-label="Task details">
        {isPending && (
          <div className="page-loading">
            <span className="spinner" />
          </div>
        )}
        {error && (
          <div className="panel-body">
            <p className="alert alert-error">{error.message}</p>
            <button className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        )}
        {task && (
          <>
            <header className="panel-head">
              <select
                className="status-select"
                value={task.columnId}
                disabled={!canEdit}
                onChange={(e) => run(() => api.moveTask(taskId, Number(e.target.value), 0))}
                aria-label="Column"
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="panel-head-actions">
                {canEdit && (
                  <button className={`btn btn-sm ${task.done ? 'btn-secondary' : 'btn-primary'}`} onClick={() => update({ done: !task.done })}>
                    <Icon name="check" size={14} strokeWidth={2.4} /> {task.done ? 'Completed' : 'Mark complete'}
                  </button>
                )}
                {canEdit && (
                  <Dropdown
                    align="right"
                    trigger={({ toggle }) => (
                      <button className="icon-btn" onClick={toggle} aria-label="Task options">
                        <Icon name="more" />
                      </button>
                    )}
                  >
                    <button className="menu-item danger" onClick={() => setConfirmDelete(true)}>
                      <Icon name="trash" size={16} /> Delete task
                    </button>
                  </Dropdown>
                )}
                <button className="icon-btn" onClick={onClose} aria-label="Close">
                  <Icon name="x" />
                </button>
              </div>
            </header>

            <div className="panel-body">
              <TitleField value={task.title} disabled={!canEdit} onSave={(title) => update({ title })} />
              {!canEdit && (
                <p className="notice small">
                  <Icon name="eye" size={14} /> View only. You can still comment.
                </p>
              )}

              <dl className="props">
                <dt>Assignees</dt>
                <dd>
                  <AssigneePicker members={members} value={task.assigneeIds} disabled={!canEdit} onChange={(assigneeIds) => update({ assigneeIds })} />
                </dd>
                <dt>Due date</dt>
                <dd>
                  <DueField task={task} disabled={!canEdit} onChange={(dueDate) => update({ dueDate })} />
                </dd>
                <dt>Priority</dt>
                <dd>
                  <PriorityPicker value={task.priority} disabled={!canEdit} onChange={(priority) => update({ priority })} />
                </dd>
                <dt>Labels</dt>
                <dd>
                  <LabelPicker
                    labels={labels}
                    value={task.labelIds}
                    disabled={!canEdit}
                    onChange={(labelIds) => update({ labelIds })}
                    onCreate={(label) => run(() => api.createLabel(board.id, label))}
                  />
                </dd>
              </dl>

              <Section title="Description" icon="list">
                <DescriptionField value={task.description} disabled={!canEdit} onSave={(description) => update({ description })} />
              </Section>

              <Checklist task={task} canEdit={canEdit} run={run} />

              <Attachments task={task} canEdit={canEdit} run={run} toast={toast} />

              <Comments task={task} me={me} members={members} run={run} />

              <Section title="Activity" icon="clock">
                <ActivityList entries={task.activity} inTask />
              </Section>
            </div>
          </>
        )}
      </aside>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete “${task.title}”?`}
          description="Its checklist, comments and files are deleted too. This can't be undone."
          confirmLabel="Delete task"
          danger
          onConfirm={async () => {
            await api.deleteTask(taskId);
            await client.invalidateQueries({ queryKey: keys.boardFull(board.id) });
            toast('Task deleted', 'success');
            onClose();
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}

function Section({ title, icon, aside, children }) {
  return (
    <section className="panel-section">
      <h3>
        <Icon name={icon} size={16} /> {title}
        {aside && <span className="panel-section-aside">{aside}</span>}
      </h3>
      {children}
    </section>
  );
}

function TitleField({ value, disabled, onSave }) {
  const [text, setText] = useState(value);
  const ref = useRef(null);
  useEffect(() => setText(value), [value]);
  // Grow with the text, so long titles wrap instead of scrolling.
  useLayoutEffect(() => {
    const el = ref.current;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  const save = () => {
    const title = text.trim();
    if (title && title !== value) onSave(title);
    else setText(value);
  };
  return (
    <textarea
      ref={ref}
      className="title-input"
      value={text}
      rows={1}
      maxLength={200}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      aria-label="Title"
    />
  );
}

function DueField({ task, disabled, onChange }) {
  const due = dueInfo(task.dueDate, task.done);
  return (
    <div className="due-field">
      <input type="date" className="input input-sm" value={task.dueDate ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} aria-label="Due date" />
      {due && <span className={`badge ${due.tone}`}>{due.overdue ? 'Overdue' : due.label}</span>}
    </div>
  );
}

function DescriptionField({ value, disabled, onSave }) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => setText(value), [value]);

  if (!editing) {
    return (
      <div
        className={`description ${value ? '' : 'is-empty'} ${disabled ? '' : 'is-editable'}`}
        onClick={() => !disabled && setEditing(true)}
        role={disabled ? undefined : 'button'}
        tabIndex={disabled ? undefined : 0}
        onKeyDown={(e) => e.key === 'Enter' && !disabled && setEditing(true)}
      >
        {value || (disabled ? 'No description.' : 'Add more detail: context, links, acceptance criteria…')}
      </div>
    );
  }
  return (
    <div className="description-edit">
      <textarea className="input" rows={6} value={text} maxLength={5000} autoFocus onChange={(e) => setText(e.target.value)} />
      <div className="row-actions">
        <button
          className="btn btn-primary btn-sm"
          onClick={async () => {
            await onSave(text);
            setEditing(false);
          }}
        >
          Save
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setText(value);
            setEditing(false);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Checklist({ task, canEdit, run }) {
  const [text, setText] = useState('');
  const done = task.checklist.filter((i) => i.done).length;
  const pct = task.checklist.length ? Math.round((done / task.checklist.length) * 100) : 0;

  async function add(event) {
    event.preventDefault();
    if (!text.trim()) return;
    await run(() => api.addChecklistItem(task.id, text.trim()));
    setText('');
  }

  return (
    <Section title="Checklist" icon="check" aside={task.checklist.length ? `${done}/${task.checklist.length}` : null}>
      {task.checklist.length > 0 && (
        <div className="progress checklist-progress">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      <ul className="checklist">
        {task.checklist.map((item) => (
          <li key={item.id} className={item.done ? 'is-done' : ''}>
            <label className="task-check">
              <input type="checkbox" checked={item.done} disabled={!canEdit} onChange={() => run(() => api.updateChecklistItem(item.id, { done: !item.done }))} />
              <span className="checkmark">
                <Icon name="check" size={12} strokeWidth={3} />
              </span>
              <span>{item.text}</span>
            </label>
            {canEdit && (
              <button className="icon-btn danger" onClick={() => run(() => api.deleteChecklistItem(item.id))} aria-label={`Remove ${item.text}`}>
                <Icon name="x" size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form className="inline-add" onSubmit={add}>
          <input className="input input-sm" placeholder="Add an item" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-secondary btn-sm" disabled={!text.trim()}>
            Add
          </button>
        </form>
      )}
    </Section>
  );
}

function Attachments({ task, canEdit, run, toast }) {
  const fileInput = useRef(null);
  const [uploading, setUploading] = useState(false);

  async function pick(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) return toast(`“${file.name}” is larger than 10 MB`, 'error');
    setUploading(true);
    await run(() => api.upload(task.id, file), 'File attached');
    setUploading(false);
  }

  if (!canEdit && task.attachments.length === 0) return null;
  return (
    <Section title="Files" icon="clip">
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
            <input ref={fileInput} type="file" hidden onChange={pick} />
            <button className="btn btn-secondary btn-sm" onClick={() => fileInput.current.click()} disabled={uploading}>
              <Icon name="plus" size={14} /> {uploading ? 'Uploading…' : 'Attach a file'}
            </button>
          </>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- comments

function Comments({ task, me, members, run }) {
  return (
    <Section title="Comments" icon="mail" aside={task.comments.length || null}>
      <ul className="comments">
        {task.comments.map((comment) => (
          <Comment key={comment.id} comment={comment} me={me} members={members} run={run} canDelete={comment.author.id === me?.id || task.role === 'owner'} />
        ))}
      </ul>
      <CommentComposer members={members} onSubmit={(body, mentions) => run(() => api.addComment(task.id, body, mentions))} />
    </Section>
  );
}

function Comment({ comment, me, members, run, canDelete }) {
  const [editing, setEditing] = useState(false);
  const mine = comment.author.id === me?.id;
  const edited = comment.updatedAt && new Date(comment.updatedAt) - new Date(comment.createdAt) > 1000;
  return (
    <li className="comment">
      <Avatar name={comment.author.name} seed={comment.author.email} url={comment.author.avatarUrl} size="sm" />
      <div className="comment-main">
        <p className="comment-head">
          <b>{comment.author.name}</b>
          <span className="faint small">
            {timeAgo(comment.createdAt)}
            {edited && ' · edited'}
          </span>
          {(mine || canDelete) && !editing && (
            <span className="comment-actions">
              {mine && (
                <button className="link-inline small" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
              {canDelete && (
                <button className="link-inline small danger" onClick={() => run(() => api.deleteComment(comment.id))}>
                  Delete
                </button>
              )}
            </span>
          )}
        </p>
        {editing ? (
          <CommentComposer
            members={members}
            initial={comment.body}
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={async (body, mentions) => {
              await run(() => api.updateComment(comment.id, body, mentions));
              setEditing(false);
            }}
          />
        ) : (
          <p className="comment-body">{highlightMentions(comment.body, members, comment.mentions)}</p>
        )}
      </div>
    </li>
  );
}

// Shows @Name in accent colour for people who were actually mentioned.
function highlightMentions(body, members, mentionIds) {
  const names = members.filter((m) => mentionIds.includes(m.id)).map((m) => m.name);
  if (!names.length) return body;
  const pattern = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'g');
  return body.split(pattern).map((part, i) => (i % 2 ? <span key={i} className="mention">{part}</span> : part));
}

// A textarea with @mention suggestions for workspace members.
function CommentComposer({ members, initial = '', submitLabel = 'Comment', onSubmit, onCancel }) {
  const [text, setText] = useState(initial);
  const [query, setQuery] = useState(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  const suggestions = query === null ? [] : members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 5);

  function onChange(event) {
    const value = event.target.value;
    setText(value);
    const upToCursor = value.slice(0, event.target.selectionStart);
    const match = upToCursor.match(/(?:^|\s)@([\p{L}\p{N}' .-]{0,30})$/u);
    setQuery(match ? match[1] : null);
    setActive(0);
  }

  function choose(member) {
    const el = ref.current;
    const cursor = el.selectionStart;
    const before = text.slice(0, cursor).replace(/@([\p{L}\p{N}' .-]{0,30})$/u, `@${member.name} `);
    const next = before + text.slice(cursor);
    setText(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  }

  async function submit(event) {
    event?.preventDefault();
    const body = text.trim();
    if (!body) return;
    const mentions = members.filter((m) => body.includes(`@${m.name}`)).map((m) => m.id);
    setBusy(true);
    await onSubmit(body, mentions);
    setBusy(false);
    if (!onCancel) setText('');
  }

  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer-field">
        <textarea
          ref={ref}
          className="input"
          rows={initial ? 3 : 2}
          value={text}
          maxLength={5000}
          placeholder="Write a comment… type @ to mention someone"
          onChange={onChange}
          onKeyDown={(e) => {
            if (suggestions.length) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((active + 1) % suggestions.length);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((active - 1 + suggestions.length) % suggestions.length);
              } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                choose(suggestions[active]);
              } else if (e.key === 'Escape') {
                setQuery(null);
              }
              return;
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
          }}
          aria-label="Comment"
        />
        {suggestions.length > 0 && (
          <ul className="menu mention-menu" role="listbox">
            {suggestions.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={`menu-item ${i === active ? 'is-active' : ''}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(m);
                  }}
                >
                  <Avatar name={m.name} seed={m.email} url={m.avatarUrl} size="sm" /> {m.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="row-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        )}
        {!onCancel && <span className="faint small">Ctrl + Enter to send</span>}
      </div>
    </form>
  );
}
