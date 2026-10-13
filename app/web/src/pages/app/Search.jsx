// Search and filter tasks across every board in the workspace. Filters live in the URL,
// so a search can be bookmarked or shared.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { EmptyState } from '../../components/ui.jsx';
import { localToday, PRIORITIES } from '../../lib/format.js';
import { useBoards, useMembers, useSearch, useWorkspaces } from '../../lib/queries.js';
import { useCurrentWorkspace } from './AppLayout.jsx';
import { TaskRowLink } from './TaskRow.jsx';

const FILTERS = ['assignee', 'priority', 'due', 'status', 'boardId'];

export default function Search() {
  const workspaceId = Number(useParams().workspaceId);
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const inputRef = useRef(null);
  const { setWorkspaceId } = useCurrentWorkspace();
  const { data: workspaces = [] } = useWorkspaces();
  const { data: boards = [] } = useBoards(workspaceId);
  const { data: memberList = [] } = useMembers(workspaceId);
  const members = useMemo(() => new Map(memberList.map((m) => [m.id, m])), [memberList]);
  const workspace = workspaces.find((w) => w.id === workspaceId);

  useEffect(() => {
    if (workspace) setWorkspaceId(workspace.id);
  }, [workspace?.id]);

  useEffect(() => inputRef.current?.focus(), []);

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const timer = setTimeout(() => update({ q: text.trim() || null }), 250);
    return () => clearTimeout(timer);
  }, [text]);

  function update(changes) {
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
        return next;
      },
      { replace: true },
    );
  }

  const query = useMemo(() => {
    const q = { today: localToday() };
    for (const key of ['q', ...FILTERS]) if (params.get(key)) q[key] = params.get(key);
    return q;
  }, [params]);
  const active = FILTERS.filter((k) => params.get(k)).length + (params.get('q') ? 1 : 0);
  const { data: results = [], isFetching, error } = useSearch(workspaceId, query, true);

  const select = (key, label, options) => (
    <select className={`input input-sm filter ${params.get(key) ? 'is-set' : ''}`} value={params.get(key) ?? ''} onChange={(e) => update({ [key]: e.target.value || null })} aria-label={label}>
      {options.map(([value, text]) => (
        <option key={value} value={value}>
          {text}
        </option>
      ))}
    </select>
  );

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <div>
          <h1>Search</h1>
          <p className="muted page-sub">Find tasks across every board in {workspace?.name ?? 'this workspace'}.</p>
        </div>
      </header>

      <div className="search-box">
        <Icon name="search" size={18} />
        <input ref={inputRef} className="search-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search titles and descriptions…" maxLength={200} aria-label="Search" />
        {isFetching && <span className="spinner" style={{ width: 14, height: 14 }} />}
        {text && (
          <button className="icon-btn" onClick={() => setText('')} aria-label="Clear search">
            <Icon name="x" size={16} />
          </button>
        )}
      </div>

      <div className="filter-bar">
        {select('assignee', 'Assignee', [['', 'Anyone'], ['me', 'Assigned to me'], ['none', 'Unassigned'], ...memberList.map((m) => [String(m.id), m.name])])}
        {select('status', 'Status', [['', 'Open and done'], ['open', 'Open'], ['done', 'Done']])}
        {select('due', 'Due', [['', 'Any due date'], ['overdue', 'Overdue'], ['today', 'Due today'], ['week', 'Due this week'], ['none', 'No due date']])}
        {select('priority', 'Priority', [['', 'Any priority'], ...PRIORITIES.map((p) => [p.value, p.label])])}
        {select('boardId', 'Board', [['', 'All boards'], ...boards.map((b) => [String(b.id), b.name])])}
        {active > 0 && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setText('');
              update(Object.fromEntries(['q', ...FILTERS].map((k) => [k, null])));
            }}
          >
            Clear all
          </button>
        )}
      </div>

      {error && <p className="alert alert-error">{error.message}</p>}
      <p className="faint small results-count">
        {active ? `${results.length}${results.length === 100 ? '+' : ''} ${results.length === 1 ? 'result' : 'results'}` : 'Recently updated'}
      </p>
      {results.length === 0 && !isFetching ? (
        <EmptyState icon="search" title="No tasks match">
          Try fewer words or clear a filter.
        </EmptyState>
      ) : (
        <div className="card task-link-list search-results">
          {results.map((t) => (
            <TaskRowLink key={t.id} task={t} members={members} highlight={params.get('q')} />
          ))}
        </div>
      )}
    </div>
  );
}
