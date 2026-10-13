// Ctrl+K: jump to any page, board or workspace, find tasks, and run common actions from
// the keyboard. "New task" turns the input into a title field for the open board.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../lib/api.js';
import { localToday, modKey } from '../lib/format.js';
import { keys, useMe, useSearch } from '../lib/queries.js';
import Icon from './Icon.jsx';
import { useTimerControls } from './Timer.jsx';
import { useToast } from './Toaster.jsx';

const GROUPS = ['Actions', 'Go to', 'Boards', 'Workspaces', 'Tasks', 'Preferences'];

// Every word of the query must appear; labels that start with it rank first.
function score(item, query) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const label = item.label.toLowerCase();
  const haystack = `${label} ${item.keywords ?? ''} ${item.hint ?? ''}`.toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.every((w) => haystack.includes(w))) return 0;
  if (label.startsWith(q)) return 3;
  if (words.every((w) => label.split(/\s+/).some((part) => part.startsWith(w)))) return 2;
  return 1;
}

// Bolds the first place the query appears in the label.
function highlight(label, query) {
  const i = query ? label.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i < 0) return label;
  return (
    <>
      {label.slice(0, i)}
      <mark>{label.slice(i, i + query.length)}</mark>
      {label.slice(i + query.length)}
    </>
  );
}

export default function CommandPalette({ initialMode = 'search', workspace, workspaces, boards, boardId, taskId, actions, onClose }) {
  const [mode, setMode] = useState(initialMode);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const { timer, start, stop } = useTimerControls();

  const ws = workspace?.id;
  const isOwner = workspace?.role === 'owner';
  const board = boards.find((b) => b.id === boardId);
  const boardRole = client.getQueryData(keys.boardFull(boardId))?.board.role ?? workspace?.role;
  const canEdit = workspace && workspace.role !== 'viewer';
  const task = taskId ? client.getQueryData(keys.task(taskId)) : null;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 150);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setActive(0), [query, mode]);
  useEffect(() => inputRef.current?.focus(), [mode]);

  const searching = mode === 'search' && debounced.length >= 2;
  const searchParams = useMemo(() => ({ q: debounced, today: localToday() }), [debounced]);
  const { data: found = [], isFetching } = useSearch(ws, searchParams, searching);

  const go = (to) => () => navigate(to);

  // Rebuilt each render: it's a few dozen objects, and it always sees the current state.
  const commands = (() => {
    const list = [];
    const add = (group, item) => list.push({ group, ...item });

    if (board && boardRole !== 'viewer') {
      add('Actions', { id: 'new-task', icon: 'plus', label: `New task in ${board.name}`, keywords: 'add create card', kbd: 'C', keep: true, run: () => setMode('task') });
    }
    if (canEdit) add('Actions', { id: 'new-board', icon: 'board', label: 'New board…', keywords: 'create template', run: actions.newBoard });
    if (timer) {
      add('Actions', { id: 'stop-timer', icon: 'stop', label: `Stop the timer on “${timer.title}”`, keywords: 'time tracking', run: stop });
    }
    if (task && task.role !== 'viewer' && timer?.taskId !== task.id) {
      add('Actions', { id: 'start-timer', icon: 'play', label: `Start a timer on “${task.title}”`, keywords: 'time tracking track', run: () => start(task) });
    }
    if (board) {
      add('Actions', { id: 'export-csv', icon: 'download', label: `Export ${board.name} as CSV`, keywords: 'spreadsheet download', run: () => (window.location.href = api.exportUrl(board.id, 'csv')) });
      add('Actions', { id: 'export-pdf', icon: 'download', label: `Export ${board.name} as PDF`, keywords: 'print download', run: () => (window.location.href = api.exportUrl(board.id, 'pdf')) });
    }
    if (isOwner) add('Actions', { id: 'invite', icon: 'users', label: 'Invite people', keywords: 'member teammate add', run: go(`/app/w/${ws}/members`) });

    if (ws) {
      add('Go to', { id: 'go-boards', icon: 'home', label: 'Boards', hint: workspace.name, kbd: 'G B', run: go(`/app/w/${ws}`) });
      add('Go to', { id: 'go-dashboard', icon: 'chart', label: 'Dashboard', kbd: 'G D', run: go(`/app/w/${ws}/dashboard`) });
      add('Go to', { id: 'go-calendar', icon: 'calendar', label: 'Calendar', kbd: 'G C', run: go(`/app/w/${ws}/calendar`) });
      add('Go to', { id: 'go-search', icon: 'search', label: 'Search and filters', keywords: 'find', kbd: 'G S', run: go(`/app/w/${ws}/search`) });
      add('Go to', { id: 'go-timesheet', icon: 'timer', label: 'Timesheet', keywords: 'time hours', kbd: 'G T', run: go(`/app/w/${ws}/timesheet`) });
      add('Go to', { id: 'go-members', icon: 'users', label: 'Members', keywords: 'people team', kbd: 'G M', run: go(`/app/w/${ws}/members`) });
      if (isOwner) add('Go to', { id: 'go-admin', icon: 'shield', label: 'Admin', keywords: 'plan usage billing audit log', kbd: 'G A', run: go(`/app/w/${ws}/admin`) });
    }
    add('Go to', { id: 'go-settings', icon: 'settings', label: 'Profile and settings', keywords: 'account password notifications avatar', run: go('/app/settings') });

    for (const b of boards) {
      add('Boards', { id: `board-${b.id}`, icon: 'board', label: b.name, hint: `${b.openCount} open`, run: go(`/app/boards/${b.id}`) });
    }
    for (const w of workspaces) {
      if (w.id === ws) continue;
      add('Workspaces', { id: `ws-${w.id}`, icon: 'home', label: `Switch to ${w.name}`, hint: w.role, keywords: 'workspace', run: () => actions.switchWorkspace(w.id) });
    }

    for (const [value, icon, label] of [
      ['light', 'sun', 'Light'],
      ['dark', 'moon', 'Dark'],
      ['system', 'monitor', 'System'],
    ]) {
      add('Preferences', { id: `theme-${value}`, icon, label: `Theme: ${label}`, hint: me?.theme === value ? 'Current' : '', keywords: 'appearance mode colour', run: () => actions.setTheme(value) });
    }
    add('Preferences', { id: 'shortcuts', icon: 'zap', label: 'Keyboard shortcuts', kbd: '?', keywords: 'keys help', run: actions.showShortcuts });
    add('Preferences', { id: 'tour', icon: 'compass', label: 'Take the tour', keywords: 'help welcome onboarding', run: actions.startTour });
    add('Preferences', { id: 'sign-out', icon: 'logout', label: 'Sign out', keywords: 'log out', run: actions.signOut });
    return list;
  })();

  // The visible list: everything (boards trimmed) when empty; matches plus tasks when typing.
  const items = useMemo(() => {
    if (mode !== 'search') return [];
    const q = query.trim();
    let shown = commands
      .map((item) => ({ ...item, score: score(item, q) }))
      .filter((item) => item.score > 0);
    if (!q) shown = shown.filter((item) => item.group !== 'Boards' || shown.filter((x) => x.group === 'Boards').indexOf(item) < 6);
    if (searching) {
      for (const t of found.slice(0, 8)) {
        shown.push({ group: 'Tasks', id: `task-${t.id}`, icon: t.done ? 'check' : 'list', label: t.title, hint: `${t.boardName} · ${t.columnName}`, score: 1, run: go(`/app/boards/${t.boardId}?task=${t.id}`) });
      }
    }
    return GROUPS.flatMap((group) => shown.filter((item) => item.group === group).sort((a, b) => b.score - a.score));
  }, [commands, query, mode, searching, found]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function choose(item) {
    if (!item) return;
    if (!item.keep) onClose();
    item.run();
  }

  async function createTask() {
    const title = query.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      const created = await api.createTask(board.id, { title });
      await Promise.all([client.invalidateQueries({ queryKey: keys.boardFull(board.id) }), client.invalidateQueries({ queryKey: keys.boards(ws) })]);
      onClose();
      navigate(`/app/boards/${board.id}?task=${created.id}`);
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (mode === 'task' && initialMode === 'search') return setMode('search');
      return onClose();
    }
    if (mode === 'task') {
      if (e.key === 'Enter') {
        e.preventDefault();
        createTask();
      } else if (e.key === 'Backspace' && !query && initialMode === 'search') setMode('search');
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[active]);
    }
  }

  let lastGroup = null;
  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input">
          {mode === 'task' ? (
            <span className="palette-chip">
              <Icon name="plus" size={13} strokeWidth={2.2} /> {board?.name}
            </span>
          ) : (
            <Icon name="search" size={18} />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={mode === 'task' ? 'Task title, then Enter' : 'Search tasks, boards and commands…'}
            maxLength={200}
            role="combobox"
            aria-expanded={mode === 'search'}
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `palette-${items[active].id}` : undefined}
            aria-label={mode === 'task' ? 'New task title' : 'Search tasks, boards and commands'}
          />
          {(isFetching || busy) && <span className="spinner" style={{ width: 14, height: 14 }} />}
          <kbd>Esc</kbd>
        </div>

        {mode === 'search' ? (
          <ul className="palette-list" id="palette-list" role="listbox" ref={listRef}>
            {items.length === 0 && (
              <li className="palette-empty">{searching && isFetching ? 'Searching…' : `Nothing matches “${query.trim()}”.`}</li>
            )}
            {items.map((item, i) => {
              const heading = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              return [
                heading && (
                  <li key={`h-${heading}`} className="palette-group" role="presentation">
                    {heading}
                  </li>
                ),
                <li
                  key={item.id}
                  id={`palette-${item.id}`}
                  role="option"
                  aria-selected={i === active}
                  className={`palette-item ${i === active ? 'is-active' : ''}`}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => choose(item)}
                >
                  <Icon name={item.icon} size={16} />
                  <span className="palette-label">{highlight(item.label, query.trim())}</span>
                  {item.hint && <span className="palette-hint">{item.hint}</span>}
                  {item.kbd && <kbd>{item.kbd}</kbd>}
                </li>,
              ];
            })}
          </ul>
        ) : (
          <p className="palette-task-help">
            The task goes to the first column of <b>{board?.name}</b> and opens so you can add details.
          </p>
        )}

        <footer className="palette-foot">
          {mode === 'search' ? (
            <>
              <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
              <span><kbd>↵</kbd> open</span>
              <span><kbd>{modKey}</kbd><kbd>K</kbd> toggle</span>
            </>
          ) : (
            <>
              <span><kbd>↵</kbd> create</span>
              <span><kbd>Esc</kbd> {initialMode === 'search' ? 'back' : 'cancel'}</span>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
