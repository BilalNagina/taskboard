import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { BarChart, Donut, ProgressList } from '../../components/Charts.jsx';
import Icon from '../../components/Icon.jsx';
import { Avatar, EmptyState } from '../../components/ui.jsx';
import { formatDate, localToday } from '../../lib/format.js';
import { useDashboard, useMembers, useWorkspaces } from '../../lib/queries.js';
import { useCurrentWorkspace } from './AppLayout.jsx';
import { TaskRowLink } from './TaskRow.jsx';

const PRIORITY_COLOURS = [
  ['urgent', 'Urgent', '#ef4444'],
  ['high', 'High', '#f59e0b'],
  ['medium', 'Medium', '#3b82f6'],
  ['low', 'Low', '#94a3b8'],
  ['none', 'No priority', 'var(--border-strong)'],
];

export default function Dashboard() {
  const workspaceId = Number(useParams().workspaceId);
  const { setWorkspaceId } = useCurrentWorkspace();
  const { data: workspaces = [] } = useWorkspaces();
  const { data, isPending, error } = useDashboard(workspaceId, localToday());
  const { data: memberList = [] } = useMembers(workspaceId);
  const members = useMemo(() => new Map(memberList.map((m) => [m.id, m])), [memberList]);
  const workspace = workspaces.find((w) => w.id === workspaceId);

  useEffect(() => {
    if (workspace) setWorkspaceId(workspace.id);
  }, [workspace?.id]);

  if (isPending) return <div className="page-loading"><span className="spinner" /></div>;
  if (error) return <div className="page"><p className="alert alert-error">{error.message}</p></div>;

  const { totals } = data;
  const empty = totals.open + totals.done === 0;
  const chartDay = (d) => ({ label: formatDate(d.date), value: d.count, hint: formatDate(d.date, { weekday: 'long', day: 'numeric', month: 'short' }) });

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">{formatDate(localToday(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>Dashboard</h1>
          <p className="muted page-sub">Everything happening across {workspace?.name ?? 'this workspace'}.</p>
        </div>
      </header>

      {empty ? (
        <EmptyState icon="chart" title="Nothing to report yet" action={<Link to={`/app/w/${workspaceId}`} className="btn btn-primary">Go to boards</Link>}>
          Add some tasks to your boards and this page fills up with progress, deadlines and workload.
        </EmptyState>
      ) : (
        <>
          <div className="stat-grid">
            <Stat icon="list" label="Open tasks" value={totals.open} />
            <Stat icon="check" label="Completed this week" value={totals.completedThisWeek} tone="success" />
            <Stat icon="clock" label="Overdue" value={totals.overdue} tone={totals.overdue ? 'danger' : ''} />
            <Stat icon="calendar" label="Due in the next 7 days" value={totals.dueThisWeek} tone={totals.dueThisWeek ? 'warning' : ''} />
          </div>

          <div className="dash-grid dash-grid-wide">
            <section className="card dash-card">
              <h2>Completed per day</h2>
              <BarChart data={data.completedByDay.map(chartDay)} unit="completed" />
            </section>
            <section className="card dash-card">
              <h2>Open by priority</h2>
              <Donut
                centerLabel="open"
                segments={PRIORITY_COLOURS.map(([key, label, color]) => ({ label, color, value: data.byPriority.find((p) => p.priority === key)?.count ?? 0 }))}
              />
            </section>
          </div>

          <div className="dash-grid">
            <section className="card dash-card">
              <h2>Boards</h2>
              <ProgressList
                empty="No boards yet."
                rows={data.byBoard.map((b) => ({
                  key: b.id,
                  label: <Link to={`/app/boards/${b.id}`}>{b.name}</Link>,
                  value: b.done,
                  total: b.open + b.done,
                  aside: `${b.done}/${b.open + b.done} done`,
                }))}
              />
            </section>
            <section className="card dash-card">
              <h2>Workload</h2>
              <ul className="workload">
                {data.byAssignee.map((row) => {
                  const m = members.get(row.userId);
                  if (!m) return null;
                  const max = Math.max(1, ...data.byAssignee.map((r) => r.open));
                  return (
                    <li key={row.userId}>
                      <Avatar name={m.name} seed={m.email} url={m.avatarUrl} size="sm" />
                      <span className="workload-name">{m.name}</span>
                      <span className="workload-bar">
                        <span style={{ width: `${(row.open / max) * 100}%` }} />
                      </span>
                      <span className="workload-count">{row.open}</span>
                      {row.overdue > 0 && <span className="badge badge-danger">{row.overdue} late</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>

          <div className="dash-grid dash-grid-3">
            <TaskList title="Overdue" icon="clock" tasks={data.overdue} members={members} empty="Nothing overdue. Nice." tone="danger" />
            <TaskList title="Due soon" icon="calendar" tasks={data.upcoming} members={members} empty="Nothing due in the next week." />
            <TaskList title="Assigned to me" icon="user" tasks={data.mine} members={members} empty="Nothing assigned to you." />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ icon, label, value, tone = '' }) {
  return (
    <div className={`card stat stat-${tone}`}>
      <span className="stat-icon"><Icon name={icon} size={18} /></span>
      <div>
        <p className="stat-value">{value}</p>
        <p className="stat-label">{label}</p>
      </div>
    </div>
  );
}

function TaskList({ title, icon, tasks, members, empty, tone }) {
  return (
    <section className="card dash-card">
      <h2 className={tone ? `text-${tone}` : ''}>
        <Icon name={icon} size={16} /> {title}
        {tasks.length > 0 && <span className="dash-count">{tasks.length}</span>}
      </h2>
      {tasks.length ? (
        <div className="task-link-list">
          {tasks.map((t) => (
            <TaskRowLink key={t.id} task={t} members={members} />
          ))}
        </div>
      ) : (
        <p className="faint small">{empty}</p>
      )}
    </section>
  );
}
