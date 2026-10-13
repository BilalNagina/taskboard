// Time tracked on tasks in a workspace, one week at a time: tasks down the side, days
// across the top. The week and person live in the URL, so a view can be shared.
import { useEffect, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { useNow, useTimerControls } from '../../components/Timer.jsx';
import { Avatar, EmptyState } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatDate, formatElapsed, formatMinutes, localToday } from '../../lib/format.js';
import { useMe, useMembers, useTimesheet, useWorkspaces } from '../../lib/queries.js';
import { useCurrentWorkspace } from './AppLayout.jsx';

const toDate = (iso) => new Date(`${iso}T12:00:00Z`);
const addDays = (iso, n) => new Date(toDate(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const startOfWeek = (iso) => addDays(iso, -((toDate(iso).getUTCDay() + 6) % 7)); // Monday

export default function Timesheet() {
  const workspaceId = Number(useParams().workspaceId);
  const [params, setParams] = useSearchParams();
  const { setWorkspaceId } = useCurrentWorkspace();
  const { data: me } = useMe();
  const { data: workspaces = [] } = useWorkspaces();
  const { data: memberList = [] } = useMembers(workspaceId);
  const members = useMemo(() => new Map(memberList.map((m) => [m.id, m])), [memberList]);
  const workspace = workspaces.find((w) => w.id === workspaceId);

  useEffect(() => {
    if (workspace) setWorkspaceId(workspace.id);
  }, [workspace?.id]);

  const today = localToday();
  const week = startOfWeek(/^\d{4}-\d{2}-\d{2}$/.test(params.get('week') ?? '') ? params.get('week') : today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  // "me" by default, "all" for everyone, or a member's id.
  const person = params.get('person') ?? 'me';
  const userId = person === 'all' ? null : person === 'me' ? me?.id : Number(person);
  const query = useMemo(() => ({ from: days[0], to: days[6], ...(userId ? { userId } : {}) }), [week, userId]);
  const { data: rows = [], isPending, isFetching, error } = useTimesheet(me ? workspaceId : null, query);

  const set = (changes) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
      return next;
    });

  // One row per task; with everyone selected, people's time on a task is added together.
  const { tasks, dayTotals, total, people } = useMemo(() => {
    const byTask = new Map();
    const dayTotals = Object.fromEntries(days.map((d) => [d, 0]));
    const people = new Map();
    for (const r of rows) {
      if (!byTask.has(r.taskId)) byTask.set(r.taskId, { ...r, days: {}, total: 0, people: new Set() });
      const row = byTask.get(r.taskId);
      row.days[r.day] = (row.days[r.day] ?? 0) + r.minutes;
      row.total += r.minutes;
      row.people.add(r.userId);
      dayTotals[r.day] += r.minutes;
      people.set(r.userId, (people.get(r.userId) ?? 0) + r.minutes);
    }
    const tasks = [...byTask.values()].sort((a, b) => b.total - a.total);
    return { tasks, dayTotals, total: tasks.reduce((n, t) => n + t.total, 0), people };
  }, [rows, week]);

  const busiest = days.reduce((best, d) => (dayTotals[d] > (dayTotals[best] ?? 0) ? d : best), null);
  const thisWeek = week === startOfWeek(today);
  const who = person === 'all' ? 'everyone' : userId === me?.id ? 'you' : members.get(userId)?.name ?? 'this person';

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <h1>Timesheet</h1>
          <p className="muted page-sub">Time tracked on tasks in {workspace?.name ?? 'this workspace'}.</p>
        </div>
        <div className="page-actions">
          <a className="btn btn-secondary" href={api.timesheetCsvUrl(workspaceId, query)} download>
            <Icon name="download" size={16} /> Export CSV
          </a>
        </div>
      </header>

      <RunningTimer />

      <div className="cal-toolbar">
        <div className="cal-nav">
          <button className="icon-btn" onClick={() => set({ week: addDays(week, -7) })} aria-label="Previous week">
            <Icon name="chevronRight" style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => set({ week: null })} disabled={thisWeek}>
            This week
          </button>
          <button className="icon-btn" onClick={() => set({ week: addDays(week, 7) })} aria-label="Next week">
            <Icon name="chevronRight" />
          </button>
          <h2 className="cal-title">
            {formatDate(days[0])} – {formatDate(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}
          </h2>
          {isFetching && <span className="spinner" style={{ width: 14, height: 14 }} />}
        </div>
        <select className={`input input-sm filter ${person !== 'me' ? 'is-set' : ''}`} value={person} onChange={(e) => set({ person: e.target.value === 'me' ? null : e.target.value })} aria-label="Person">
          <option value="me">My time</option>
          <option value="all">Everyone</option>
          {memberList
            .filter((m) => m.id !== me?.id)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </div>

      {error && <p className="alert alert-error">{error.message}</p>}

      <div className="stat-grid stat-grid-3">
        <div className="card stat">
          <span className="stat-icon"><Icon name="timer" size={18} /></span>
          <div>
            <p className="stat-value">{formatMinutes(total)}</p>
            <p className="stat-label">Logged by {who}</p>
          </div>
        </div>
        <div className="card stat">
          <span className="stat-icon"><Icon name="list" size={18} /></span>
          <div>
            <p className="stat-value">{tasks.length}</p>
            <p className="stat-label">{tasks.length === 1 ? 'Task' : 'Tasks'} worked on</p>
          </div>
        </div>
        <div className="card stat">
          <span className="stat-icon"><Icon name="calendar" size={18} /></span>
          <div>
            <p className="stat-value">{busiest ? formatDate(busiest, { weekday: 'short' }) : '–'}</p>
            <p className="stat-label">{busiest ? `Busiest day · ${formatMinutes(dayTotals[busiest])}` : 'Busiest day'}</p>
          </div>
        </div>
      </div>

      {!isPending && tasks.length === 0 ? (
        <div className="card">
          <EmptyState icon="timer" title="No time logged this week">
            Open a task and press Start timer, or use Log time to add time you’ve already spent.
          </EmptyState>
        </div>
      ) : (
        <div className="card timesheet-wrap">
          <table className="timesheet">
            <thead>
              <tr>
                <th scope="col" className="ts-task">Task</th>
                {days.map((d) => (
                  <th key={d} scope="col" className={d === today ? 'is-today' : ''}>
                    <span>{formatDate(d, { weekday: 'short' })}</span>
                    <small>{Number(d.slice(8))}</small>
                  </th>
                ))}
                <th scope="col" className="ts-total">Total</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.taskId}>
                  <th scope="row" className="ts-task">
                    <Link to={`/app/boards/${t.boardId}?task=${t.taskId}`} className="ts-title">
                      {t.title}
                    </Link>
                    <span className="ts-sub">
                      <span className="faint">{t.boardName}</span>
                      {person === 'all' && (
                        <span className="avatar-stack">
                          {[...t.people].slice(0, 4).map((id) => {
                            const m = members.get(id);
                            return m ? <Avatar key={id} name={m.name} seed={m.email} url={m.avatarUrl} size="sm" /> : null;
                          })}
                        </span>
                      )}
                    </span>
                  </th>
                  {days.map((d) => (
                    <td key={d} className={`${d === today ? 'is-today' : ''} ${t.days[d] ? '' : 'is-empty'}`}>
                      {t.days[d] ? formatMinutes(t.days[d]) : '–'}
                    </td>
                  ))}
                  <td className="ts-total">{formatMinutes(t.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="ts-task">Total</th>
                {days.map((d) => (
                  <td key={d} className={d === today ? 'is-today' : ''}>
                    {dayTotals[d] ? formatMinutes(dayTotals[d]) : '–'}
                  </td>
                ))}
                <td className="ts-total">{formatMinutes(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {person === 'all' && people.size > 0 && (
        <section className="card dash-card ts-people">
          <h2>By person</h2>
          <ul className="workload">
            {[...people.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([id, minutes]) => {
                const m = members.get(id);
                if (!m) return null;
                return (
                  <li key={id}>
                    <Avatar name={m.name} seed={m.email} url={m.avatarUrl} size="sm" />
                    <span className="workload-name">{m.name}</span>
                    <span className="workload-bar">
                      <span style={{ width: `${(minutes / Math.max(...people.values())) * 100}%` }} />
                    </span>
                    <span className="ts-person-total">{formatMinutes(minutes)}</span>
                  </li>
                );
              })}
          </ul>
        </section>
      )}
    </div>
  );
}

// The running timer isn't on the sheet until it stops; say so here.
function RunningTimer() {
  const { timer, startedAt, stop } = useTimerControls();
  const now = useNow(Boolean(timer));
  if (!timer) return null;
  return (
    <div className="notice ts-running">
      <span className="timer-dot" />
      <span>
        Timer running on <Link to={`/app/boards/${timer.boardId}?task=${timer.taskId}`}>{timer.title}</Link> for{' '}
        <b className="timer-clock">{formatElapsed((now - startedAt) / 1000)}</b>. It’s added here when you stop it.
      </span>
      <button className="btn btn-secondary btn-sm" onClick={stop}>
        <Icon name="stop" size={13} strokeWidth={2.4} /> Stop
      </button>
    </div>
  );
}
