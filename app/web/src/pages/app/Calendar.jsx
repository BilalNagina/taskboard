// Tasks by due date across a workspace. Month and week views; drag a task onto another
// day to move its due date.
import { useEffect, useMemo, useState } from 'react';
import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/Toaster.jsx';
import { api } from '../../lib/api.js';
import { formatDate, localToday } from '../../lib/format.js';
import { useBoards, useCalendar, useWorkspaces } from '../../lib/queries.js';
import { useCurrentWorkspace } from './AppLayout.jsx';

// Dates are 'YYYY-MM-DD' strings, handled at UTC noon so DST never shifts a day.
const toDate = (iso) => new Date(`${iso}T12:00:00Z`);
const toIso = (date) => date.toISOString().slice(0, 10);
const addDays = (iso, n) => toIso(new Date(toDate(iso).getTime() + n * 86_400_000));
const startOfWeek = (iso) => addDays(iso, -((toDate(iso).getUTCDay() + 6) % 7)); // Monday
const startOfMonth = (iso) => `${iso.slice(0, 7)}-01`;
const addMonths = (iso, n) => {
  const d = toDate(startOfMonth(iso));
  d.setUTCMonth(d.getUTCMonth() + n);
  return toIso(d);
};
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function Calendar() {
  const workspaceId = Number(useParams().workspaceId);
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'week' ? 'week' : 'month';
  const cursor = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date') : localToday();
  const boardId = Number(params.get('board')) || null;
  const [showDone, setShowDone] = useState(true);
  const { setWorkspaceId } = useCurrentWorkspace();
  const { data: workspaces = [] } = useWorkspaces();
  const { data: boards = [] } = useBoards(workspaceId);
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const canEdit = workspace && workspace.role !== 'viewer';
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (workspace) setWorkspaceId(workspace.id);
  }, [workspace?.id]);

  const first = view === 'month' ? startOfWeek(startOfMonth(cursor)) : startOfWeek(cursor);
  const dayCount = view === 'month' ? 42 : 7;
  const last = addDays(first, dayCount - 1);
  const days = Array.from({ length: dayCount }, (_, i) => addDays(first, i));
  const { data: tasks = [], isFetching } = useCalendar(workspaceId, first, last, boardId);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const t of tasks) {
      if (!showDone && t.done) continue;
      if (!map.has(t.dueDate)) map.set(t.dueDate, []);
      map.get(t.dueDate).push(t);
    }
    return map;
  }, [tasks, showDone]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }));

  const set = (changes) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
      return next;
    });
  const step = (n) => set({ date: view === 'month' ? addMonths(cursor, n) : addDays(cursor, 7 * n) });

  async function onDragEnd({ active, over }) {
    if (!over) return;
    const task = tasks.find((t) => t.id === active.data.current.taskId);
    const dueDate = over.id;
    if (!task || task.dueDate === dueDate) return;
    const key = ['calendar', workspaceId, first, last, boardId];
    client.setQueryData(key, (old) => old?.map((t) => (t.id === task.id ? { ...t, dueDate } : t)));
    try {
      await api.updateTask(task.id, { dueDate });
      toast(`“${task.title}” moved to ${formatDate(dueDate, { weekday: 'short', day: 'numeric', month: 'short' })}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    client.invalidateQueries({ queryKey: ['calendar', workspaceId] });
    client.invalidateQueries({ queryKey: ['dashboard', workspaceId] });
    client.invalidateQueries({ queryKey: ['boardFull', task.boardId] });
  }

  const open = (task) => navigate(`/app/boards/${task.boardId}?task=${task.id}`);
  const title =
    view === 'month'
      ? toDate(cursor).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
      : `${formatDate(first)} – ${formatDate(last, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const today = localToday();
  const visibleCount = [...byDay.values()].reduce((n, list) => n + list.length, 0);

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <h1>Calendar</h1>
          <p className="muted page-sub">
            {visibleCount} {visibleCount === 1 ? 'task' : 'tasks'} due in this {view}
            {canEdit && ' · drag a task to another day to reschedule it'}
          </p>
        </div>
      </header>

      <div className="cal-toolbar">
        <div className="cal-nav">
          <button className="icon-btn" onClick={() => step(-1)} aria-label={`Previous ${view}`}>
            <Icon name="chevronRight" style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => set({ date: null })}>
            Today
          </button>
          <button className="icon-btn" onClick={() => step(1)} aria-label={`Next ${view}`}>
            <Icon name="chevronRight" />
          </button>
          <h2 className="cal-title">{title}</h2>
          {isFetching && <span className="spinner" style={{ width: 14, height: 14 }} />}
        </div>
        <div className="cal-filters">
          <select className="input input-sm" value={boardId ?? ''} onChange={(e) => set({ board: e.target.value || null })} aria-label="Board">
            <option value="">All boards</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <label className="toggle">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            <span>Show completed</span>
          </label>
          <div className="segmented" role="group" aria-label="View">
            <button className={view === 'month' ? 'active' : ''} onClick={() => set({ view: null })}>
              Month
            </button>
            <button className={view === 'week' ? 'active' : ''} onClick={() => set({ view: 'week' })}>
              Week
            </button>
          </div>
        </div>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className={`cal cal-${view}`}>
          {WEEKDAYS.map((d) => (
            <div key={d} className="cal-weekday">
              {d}
            </div>
          ))}
          {days.map((day) => (
            <Day
              key={day}
              day={day}
              tasks={byDay.get(day) ?? []}
              outside={view === 'month' && day.slice(0, 7) !== cursor.slice(0, 7)}
              isToday={day === today}
              view={view}
              canEdit={canEdit}
              onOpen={open}
            />
          ))}
        </div>
      </DndContext>

      {/* Phones get a list of days with tasks instead of the grid. */}
      <div className="cal-agenda">
        {days.filter((d) => byDay.has(d) && !(view === 'month' && d.slice(0, 7) !== cursor.slice(0, 7))).length === 0 && (
          <p className="faint small">Nothing due in this {view}.</p>
        )}
        {days
          .filter((d) => byDay.has(d) && !(view === 'month' && d.slice(0, 7) !== cursor.slice(0, 7)))
          .map((d) => (
            <section key={d}>
              <h3 className={d === today ? 'is-today' : ''}>{formatDate(d, { weekday: 'long', day: 'numeric', month: 'short' })}</h3>
              {byDay.get(d).map((t) => (
                <button key={t.id} className={`cal-chip prio-edge-${t.priority} ${t.done ? 'is-done' : ''}`} onClick={() => open(t)}>
                  <span>{t.title}</span>
                  <small className="faint">{t.boardName}</small>
                </button>
              ))}
            </section>
          ))}
      </div>
    </div>
  );
}

function Day({ day, tasks, outside, isToday, view, canEdit, onOpen }) {
  const { setNodeRef, isOver } = useDroppable({ id: day, disabled: !canEdit });
  const [expanded, setExpanded] = useState(false);
  const limit = view === 'month' && !expanded ? 3 : Infinity;
  return (
    <div ref={setNodeRef} className={`cal-day ${outside ? 'is-outside' : ''} ${isToday ? 'is-today' : ''} ${isOver ? 'is-over' : ''}`}>
      <span className="cal-date">{Number(day.slice(8))}</span>
      <div className="cal-items">
        {tasks.slice(0, limit).map((t) => (
          <Chip key={t.id} task={t} canEdit={canEdit} onOpen={onOpen} />
        ))}
        {tasks.length > limit && (
          <button className="cal-more" onClick={() => setExpanded(true)}>
            +{tasks.length - limit} more
          </button>
        )}
      </div>
    </div>
  );
}

function Chip({ task, canEdit, onOpen }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `cal-${task.id}`,
    data: { taskId: task.id },
    disabled: !canEdit,
  });
  return (
    <button
      ref={setNodeRef}
      className={`cal-chip prio-edge-${task.priority} ${task.done ? 'is-done' : ''} ${isDragging ? 'is-dragging' : ''}`}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      onClick={() => onOpen(task)}
      title={`${task.title} · ${task.boardName}`}
      {...attributes}
      {...listeners}
    >
      {task.title}
    </button>
  );
}
