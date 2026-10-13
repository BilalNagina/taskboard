// The board: columns of cards you can drag between, a task panel, and the activity feed.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { useToast } from '../../../components/Toaster.jsx';
import { Avatar, ConfirmDialog, Dialog, Dropdown, EmptyState, PromptDialog } from '../../../components/ui.jsx';
import { api } from '../../../lib/api.js';
import { keys, useBoardActivity, useBoardFull, useMe, useWorkspaces } from '../../../lib/queries.js';
import { daysUntil, formatDate, PRIORITIES } from '../../../lib/format.js';
import { useCurrentWorkspace } from '../AppLayout.jsx';
import { ActivityList } from './Activity.jsx';
import { CardView } from './Card.jsx';
import { SortableColumn } from './Column.jsx';
import TaskPanel from './TaskPanel.jsx';

const cardKey = (id) => `t:${id}`;
const columnKey = (id) => `c:${id}`;
const idOf = (key) => Number(String(key).slice(2));
const isColumnKey = (key) => String(key).startsWith('c:');
const NO_FILTERS = { q: '', assignee: '', label: '', priority: '', due: '' };

// column id -> ordered card ids
function groupCards(columns, cards) {
  const items = Object.fromEntries(columns.map((c) => [c.id, []]));
  for (const card of [...cards].sort((a, b) => a.position - b.position)) items[card.columnId]?.push(card.id);
  return items;
}

export default function BoardPage() {
  const boardId = Number(useParams().boardId);
  const [params, setParams] = useSearchParams();
  const openTaskId = Number(params.get('task')) || null;
  const { data, isPending, error } = useBoardFull(boardId);
  const { data: workspaces = [] } = useWorkspaces();
  const { setWorkspaceId } = useCurrentWorkspace();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  const [columnOrder, setColumnOrder] = useState([]);
  const [items, setItems] = useState({});
  const [activeKey, setActiveKey] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [showActivity, setShowActivity] = useState(false);
  const [filters, setFilters] = useState(NO_FILTERS);
  const { data: me } = useMe();
  const snapshot = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Server data drives the layout, except mid-drag when the local copy leads.
  useEffect(() => {
    if (data && !activeKey) {
      setColumnOrder(data.columns.map((c) => c.id));
      setItems(groupCards(data.columns, data.cards));
    }
  }, [data, activeKey]);

  useEffect(() => {
    if (data) setWorkspaceId(data.board.workspaceId);
  }, [data?.board.workspaceId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] } }),
  );

  // Columns snap to the nearest column; cards snap to the nearest card in the column
  // under the pointer (or to the column itself when it's empty).
  const collisionDetection = useCallback((args) => {
    if (isColumnKey(args.active.id)) {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => isColumnKey(c.id)) });
    }
    const overColumn = pointerWithin(args).find((c) => isColumnKey(c.id));
    if (overColumn) {
      const inColumn = new Set((itemsRef.current[idOf(overColumn.id)] ?? []).map(cardKey));
      const cards = args.droppableContainers.filter((c) => inColumn.has(c.id));
      return cards.length ? closestCorners({ ...args, droppableContainers: cards }) : [overColumn];
    }
    return closestCorners(args);
  }, []);

  const lookups = useMemo(
    () => ({
      cards: new Map((data?.cards ?? []).map((c) => [c.id, c])),
      labels: new Map((data?.labels ?? []).map((l) => [l.id, l])),
      members: new Map((data?.members ?? []).map((m) => [m.id, m])),
      columns: new Map((data?.columns ?? []).map((c) => [c.id, c])),
    }),
    [data],
  );

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

  const { board } = data;
  const canEdit = board.role !== 'viewer';
  // Filters only hide cards on screen; dragging pauses so positions stay unambiguous.
  const filtering = Object.values(filters).some(Boolean);
  const matches = (card) => {
    if (filters.q && !card.title.toLowerCase().includes(filters.q.toLowerCase())) return false;
    if (filters.assignee === 'me' && !card.assigneeIds.includes(me?.id)) return false;
    if (filters.assignee === 'none' && card.assigneeIds.length) return false;
    if (/^[0-9]+$/.test(filters.assignee) && !card.assigneeIds.includes(Number(filters.assignee))) return false;
    if (filters.label && !card.labelIds.includes(Number(filters.label))) return false;
    if (filters.priority && card.priority !== filters.priority) return false;
    if (filters.due) {
      const days = card.dueDate ? daysUntil(card.dueDate) : null;
      if (filters.due === 'overdue' && !(days !== null && days < 0 && !card.done)) return false;
      if (filters.due === 'week' && !(days !== null && days >= 0 && days <= 6)) return false;
      if (filters.due === 'none' && card.dueDate) return false;
    }
    return true;
  };
  const workspace = workspaces.find((w) => w.id === board.workspaceId);
  const columns = columnOrder.map((id) => lookups.columns.get(id)).filter(Boolean);
  const openTask = (id) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (id) next.set('task', id);
    else next.delete('task');
    return next;
  });

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.boardFull(boardId) }),
      client.invalidateQueries({ queryKey: keys.activity(boardId) }),
      client.invalidateQueries({ queryKey: keys.boards(board.workspaceId) }),
    ]);

  async function run(action, success) {
    try {
      const result = await action();
      await refresh();
      if (success) toast(success, 'success');
      return result;
    } catch (err) {
      toast(err.message, 'error');
      await refresh();
    }
  }

  // ------------------------------------------------------------ drag and drop

  const containerOf = (key) => {
    if (isColumnKey(key)) return idOf(key);
    const id = idOf(key);
    return Number(Object.keys(items).find((col) => items[col].includes(id)));
  };

  function onDragStart({ active }) {
    snapshot.current = { items, columnOrder };
    setActiveKey(active.id);
  }

  // Moving a card into another column updates the local layout straight away.
  function onDragOver({ active, over }) {
    if (!over || isColumnKey(active.id)) return;
    const from = containerOf(active.id);
    const to = containerOf(over.id);
    if (!from || !to || from === to) return;
    const taskId = idOf(active.id);
    setItems((prev) => {
      const target = prev[to].filter((id) => id !== taskId);
      let index = target.length;
      if (!isColumnKey(over.id)) {
        index = target.indexOf(idOf(over.id));
        const below = active.rect.current.translated && active.rect.current.translated.top > over.rect.top + over.rect.height / 2;
        if (index < 0) index = target.length;
        else if (below) index += 1;
      }
      target.splice(index, 0, taskId);
      return { ...prev, [from]: prev[from].filter((id) => id !== taskId), [to]: target };
    });
  }

  function onDragCancel() {
    if (snapshot.current) {
      setItems(snapshot.current.items);
      setColumnOrder(snapshot.current.columnOrder);
    }
    setActiveKey(null);
  }

  async function onDragEnd({ active, over }) {
    const before = snapshot.current;

    if (isColumnKey(active.id)) {
      const from = columnOrder.indexOf(idOf(active.id));
      const to = over ? columnOrder.indexOf(idOf(over.id)) : from;
      setActiveKey(null);
      if (to < 0 || from === to) return;
      const order = arrayMove(columnOrder, from, to);
      setColumnOrder(order);
      client.setQueryData(keys.boardFull(boardId), (old) => ({ ...old, columns: order.map((id) => old.columns.find((c) => c.id === id)) }));
      await run(() => api.moveColumn(idOf(active.id), to));
      return;
    }

    const taskId = idOf(active.id);
    const column = containerOf(over?.id ?? active.id);
    let next = items;
    if (over && !isColumnKey(over.id) && column && items[column].includes(idOf(over.id)) && over.id !== active.id) {
      const list = items[column];
      next = { ...items, [column]: arrayMove(list, list.indexOf(taskId), list.indexOf(idOf(over.id))) };
    }
    const index = next[column]?.indexOf(taskId) ?? -1;
    const startColumn = Number(Object.keys(before.items).find((col) => before.items[col].includes(taskId)));
    const startIndex = before.items[startColumn].indexOf(taskId);

    if (index < 0 || (column === startColumn && index === startIndex)) {
      setItems(before.items);
      setActiveKey(null);
      return;
    }

    // Show the result immediately, then save it.
    setItems(next);
    client.setQueryData(keys.boardFull(boardId), (old) => ({
      ...old,
      cards: old.cards.map((card) => {
        const col = Number(Object.keys(next).find((c) => next[c].includes(card.id)));
        return { ...card, columnId: col, position: next[col].indexOf(card.id), done: lookups.columns.get(col)?.isDone ?? card.done };
      }),
    }));
    setActiveKey(null);
    const moved = await run(() => api.moveTask(taskId, column, index));
    if (moved?.nextOccurrence) {
      toast(`Done. The next one is due ${formatDate(moved.nextOccurrence.dueDate, { weekday: 'short', day: 'numeric', month: 'short' })}`, 'success');
    }
  }

  const activeCard = activeKey && !isColumnKey(activeKey) ? lookups.cards.get(idOf(activeKey)) : null;
  const activeColumn = activeKey && isColumnKey(activeKey) ? lookups.columns.get(idOf(activeKey)) : null;

  // ------------------------------------------------------------ actions

  const addCard = (columnId, title) => run(() => api.createTask(boardId, { title, columnId }));
  const renameColumn = (column, name) => run(() => api.updateColumn(column.id, { name }));
  const toggleDone = (column) =>
    run(() => api.updateColumn(column.id, { isDone: !column.isDone }), column.isDone ? `${column.name} no longer counts as done` : `Cards in ${column.name} now count as done`);

  return (
    <div className="board-page">
      <div className="board-top">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to={`/app/w/${board.workspaceId}`}>{workspace?.name ?? 'Workspace'}</Link>
          <Icon name="chevronRight" size={14} />
          <span>{board.name}</span>
        </nav>
        <header className="board-head">
          <div className="board-title">
            <h1>{board.name}</h1>
            <span className="muted small">
              {board.openCount} open · {board.taskCount - board.openCount} done
            </span>
            {!canEdit && (
              <span className="badge">
                <Icon name="eye" size={12} /> View only
              </span>
            )}
          </div>
          <div className="board-actions">
            <Link to={`/app/w/${board.workspaceId}/members`} className="avatar-stack avatar-stack-lg" title="Workspace members">
              {data.members.slice(0, 5).map((m) => (
                <Avatar key={m.id} name={m.name} seed={m.email} url={m.avatarUrl} size="sm" />
              ))}
              {data.members.length > 5 && <span className="avatar avatar-sm avatar-more">+{data.members.length - 5}</span>}
            </Link>
            <button className={`btn btn-secondary btn-sm ${showActivity ? 'is-active' : ''}`} onClick={() => setShowActivity(!showActivity)}>
              <Icon name="clock" size={15} /> Activity
            </button>
            <Dropdown
              align="right"
              trigger={({ toggle }) => (
                <button className="btn btn-secondary btn-sm" onClick={toggle} aria-label="Export board">
                  Export <Icon name="chevronDown" size={14} />
                </button>
              )}
            >
              <a className="menu-item" href={api.exportUrl(boardId, 'csv')} download>
                <Icon name="list" size={16} /> Spreadsheet (CSV)
              </a>
              <a className="menu-item" href={api.exportUrl(boardId, 'pdf')} download>
                <Icon name="board" size={16} /> PDF document
              </a>
            </Dropdown>
            {canEdit && (
              <Dropdown
                align="right"
                trigger={({ toggle }) => (
                  <button className="btn btn-secondary btn-sm" onClick={toggle} aria-label="Board options">
                    <Icon name="more" size={16} />
                  </button>
                )}
              >
                <button className="menu-item" onClick={() => setDialog({ type: 'rename' })}>
                  <Icon name="edit" size={16} /> Rename board
                </button>
                {board.role === 'owner' && (
                  <button className="menu-item danger" onClick={() => setDialog({ type: 'delete' })}>
                    <Icon name="trash" size={16} /> Delete board
                  </button>
                )}
              </Dropdown>
            )}
          </div>
        </header>
        <div className="board-filters">
          <div className="filter-search">
            <Icon name="search" size={15} />
            <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Filter cards" aria-label="Filter cards by title" />
          </div>
          <select className={`input input-sm filter ${filters.assignee ? 'is-set' : ''}`} value={filters.assignee} onChange={(e) => setFilters({ ...filters, assignee: e.target.value })} aria-label="Assignee">
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="none">Unassigned</option>
            {data.members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <select className={`input input-sm filter ${filters.label ? 'is-set' : ''}`} value={filters.label} onChange={(e) => setFilters({ ...filters, label: e.target.value })} aria-label="Label">
            <option value="">Any label</option>
            {data.labels.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <select className={`input input-sm filter ${filters.priority ? 'is-set' : ''}`} value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })} aria-label="Priority">
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <select className={`input input-sm filter ${filters.due ? 'is-set' : ''}`} value={filters.due} onChange={(e) => setFilters({ ...filters, due: e.target.value })} aria-label="Due date">
            <option value="">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="week">Due this week</option>
            <option value="none">No due date</option>
          </select>
          {filtering && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setFilters(NO_FILTERS)}>
                Clear
              </button>
              {canEdit && <span className="faint small">Dragging is paused while filters are on.</span>}
            </>
          )}
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="kanban">
          <SortableContext items={columnOrder.map(columnKey)} strategy={horizontalListSortingStrategy}>
            {columns.map((column) => (
              <SortableColumn
                key={column.id}
                column={column}
                cards={(items[column.id] ?? []).map((id) => lookups.cards.get(id)).filter((c) => c && (!filtering || matches(c)))}
                total={filtering ? (items[column.id] ?? []).length : undefined}
                canEdit={canEdit}
                dragDisabled={filtering}
                labels={lookups.labels}
                members={lookups.members}
                onOpen={openTask}
                onAddCard={addCard}
                onRename={renameColumn}
                onToggleDone={toggleDone}
                onDelete={(c) => setDialog({ type: 'deleteColumn', column: c })}
              />
            ))}
          </SortableContext>
          {canEdit && (
            <button className="kcol-new" onClick={() => setDialog({ type: 'newColumn' })}>
              <Icon name="plus" size={16} /> Add column
            </button>
          )}
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' }}>
          {activeCard && <CardView card={activeCard} labels={lookups.labels} members={lookups.members} overlay />}
          {activeColumn && (
            <div className="kcol is-overlay">
              <header className="kcol-head">
                <h2>
                  {activeColumn.name}
                  <span className="kcol-count">{items[activeColumn.id]?.length ?? 0}</span>
                </h2>
              </header>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {openTaskId && (
        <TaskPanel
          key={openTaskId}
          taskId={openTaskId}
          board={board}
          columns={data.columns}
          labels={data.labels}
          members={data.members}
          onClose={() => openTask(null)}
        />
      )}
      {showActivity && !openTaskId && <BoardActivity boardId={boardId} onClose={() => setShowActivity(false)} onOpenTask={openTask} />}

      {dialog?.type === 'newColumn' && (
        <PromptDialog title="New column" label="Column name" maxLength={40} submitLabel="Add column" onSubmit={(name) => run(() => api.createColumn(boardId, name))} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'deleteColumn' && (
        <DeleteColumnDialog column={dialog.column} columns={data.columns} count={items[dialog.column.id]?.length ?? 0} onDelete={(moveTo) => run(() => api.deleteColumn(dialog.column.id, moveTo), 'Column deleted')} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'rename' && (
        <PromptDialog title="Rename board" label="Board name" initial={board.name} submitLabel="Save" onSubmit={(name) => run(() => api.renameBoard(boardId, name))} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'delete' && (
        <ConfirmDialog
          title={`Delete “${board.name}”?`}
          description="All of its tasks, comments and files are deleted too. This can't be undone."
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

function DeleteColumnDialog({ column, columns, count, onDelete, onClose }) {
  const others = columns.filter((c) => c.id !== column.id);
  const [moveTo, setMoveTo] = useState(others[0]?.id);
  const [busy, setBusy] = useState(false);
  if (!others.length) {
    return (
      <Dialog title="Can't delete the last column" description="A board needs at least one column." onClose={onClose}>
        <div className="dialog-actions">
          <button className="btn btn-primary" onClick={onClose}>OK</button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog title={`Delete “${column.name}”?`} description={count ? `Its ${count} ${count === 1 ? 'card moves' : 'cards move'} to another column first.` : 'The column is empty.'} onClose={onClose}>
      {count > 0 && (
        <label className="field" style={{ marginTop: 16 }}>
          <span className="field-label">Move cards to</span>
          <select className="input" value={moveTo} onChange={(e) => setMoveTo(Number(e.target.value))}>
            {others.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      )}
      <div className="dialog-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onDelete(moveTo);
            onClose();
          }}
        >
          Delete column
        </button>
      </div>
    </Dialog>
  );
}

function BoardActivity({ boardId, onClose, onOpenTask }) {
  const { data, isPending } = useBoardActivity(boardId);
  return (
    <>
      <div className="panel-scrim" onClick={onClose} />
      <aside className="panel panel-narrow" role="dialog" aria-label="Board activity">
        <header className="panel-head">
          <h2 className="panel-title"><Icon name="clock" size={18} /> Activity</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </header>
        <div className="panel-body">
          {isPending ? <span className="spinner" /> : <ActivityList entries={data} onOpenTask={onOpenTask} />}
        </div>
      </aside>
    </>
  );
}
