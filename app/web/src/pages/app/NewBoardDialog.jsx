// "New board": a name and a template to start from.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { Dialog, Field } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { localToday } from '../../lib/format.js';
import { keys, useTemplates } from '../../lib/queries.js';

export default function NewBoardDialog({ workspace, onClose }) {
  const { data: templates = [], isPending } = useTemplates();
  const [template, setTemplate] = useState('blank');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const navigate = useNavigate();

  // Picking a template suggests its name, unless the user has typed their own.
  function pick(t) {
    const previous = templates.find((x) => x.key === template);
    if (!name.trim() || name === previous?.name) setName(t.key === 'blank' ? '' : t.name);
    setTemplate(t.key);
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const board = await api.createBoard(workspace.id, { name: name.trim(), template, today: localToday() });
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.boards(workspace.id) }),
        client.invalidateQueries({ queryKey: keys.workspaces }),
      ]);
      onClose();
      navigate(`/app/boards/${board.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  // Say so up front when the plan has no room for another board.
  const limit = workspace.limits?.boards ?? null;
  const full = limit !== null && workspace.boardCount >= limit;

  return (
    <Dialog title="New board" description={`In ${workspace.name}`} onClose={onClose} wide>
      <form onSubmit={submit} className="new-board">
        {full && (
          <p className="notice notice-warning">
            <Icon name="zap" size={16} />
            <span>
              {workspace.name} has {workspace.boardCount} boards, the most the {workspace.limits.name} plan includes.{' '}
              {workspace.role === 'owner' ? (
                <Link to={`/app/w/${workspace.id}/admin`} onClick={onClose}>
                  Change the plan
                </Link>
              ) : (
                'Ask an owner to change the plan.'
              )}
            </span>
          </p>
        )}
        <Field label="Board name" error={error}>
          {(props) => (
            <input {...props} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Website launch" required />
          )}
        </Field>
        <div className="field">
          <span className="field-label">Start from</span>
          {isPending ? (
            <span className="spinner" />
          ) : (
            <div className="template-grid" role="radiogroup" aria-label="Template">
              {templates.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={template === t.key}
                  className={`template-card ${template === t.key ? 'is-selected' : ''}`}
                  onClick={() => pick(t)}
                >
                  <span className="template-preview" aria-hidden="true">
                    {t.columns.map((column, i) => (
                      <span key={column} className="template-col">
                        <span className="template-col-name">{column}</span>
                        {Array.from({ length: t.taskCount ? Math.max(1, 3 - i % 3) : 0 }, (_, j) => (
                          <span key={j} className="template-chip" />
                        ))}
                      </span>
                    ))}
                  </span>
                  <span className="template-name">
                    {t.name}
                    {template === t.key && <Icon name="check" size={15} strokeWidth={2.4} />}
                  </span>
                  <span className="template-desc">{t.description}</span>
                  <span className="template-meta">{t.taskCount ? `${t.columns.length} columns · ${t.taskCount} example cards` : `${t.columns.length} columns · empty`}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || full || !name.trim()}>
            Create board
          </button>
        </div>
      </form>
    </Dialog>
  );
}
