// Workspace admin (owners): usage against the plan, plan and billing (or free switching
// while billing is off), members at a glance, the audit log, and deleting the workspace.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/Toaster.jsx';
import { Avatar, ConfirmDialog, Dialog, EmptyState, Field, PromptDialog } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatDate, formatMinutes, formatSize, timeAgo } from '../../lib/format.js';
import { keys, useAdmin, useAuditLog, useBilling, useMe, useWorkspaces } from '../../lib/queries.js';
import { ActivityList } from './board/Activity.jsx';
import Billing, { PlanFeatures } from './Billing.jsx';
import { useCurrentWorkspace } from './AppLayout.jsx';

const MB = 1024 ** 2;
const GB = 1024 ** 3;
// Plan sizes are round numbers: "100 MB", "5 GB".
const limitSize = (bytes) => (bytes >= GB ? `${Math.round(bytes / GB)} GB` : `${Math.round(bytes / MB)} MB`);
const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;

export default function Admin() {
  const workspaceId = Number(useParams().workspaceId);
  const { setWorkspaceId } = useCurrentWorkspace();
  const { data: me } = useMe();
  const { data: workspaces = [] } = useWorkspaces();
  const listed = workspaces.find((w) => w.id === workspaceId);
  const isOwner = listed?.role === 'owner';
  const { data, isPending, error } = useAdmin(workspaceId, isOwner);
  // True from a completed checkout until the provider's webhook has switched the plan.
  const [waiting, setWaiting] = useState(false);
  const billingQuery = useBilling(workspaceId, { enabled: isOwner, waiting });
  const [dialog, setDialog] = useState(null);
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (listed) setWorkspaceId(listed.id);
  }, [listed?.id]);

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.admin(workspaceId) }),
      client.invalidateQueries({ queryKey: keys.auditLog(workspaceId) }),
      client.invalidateQueries({ queryKey: keys.workspaces }),
    ]);

  if (!listed) return <div className="page-loading"><span className="spinner" /></div>;
  if (!isOwner) {
    return (
      <div className="page">
        <EmptyState icon="shield" title="Owners only" action={<Link to={`/app/w/${workspaceId}`} className="btn btn-primary">Back to boards</Link>}>
          The admin panel is for workspace owners. Ask an owner if you need a change to the plan or members.
        </EmptyState>
      </div>
    );
  }
  if (isPending) return <div className="page-loading"><span className="spinner" /></div>;
  if (error) return <div className="page"><p className="alert alert-error">{error.message}</p></div>;

  const { workspace, usage, members, plans } = data;
  const limits = workspace.limits;

  async function switchPlan(plan) {
    try {
      await api.setPlan(workspaceId, plan.key);
      await refresh();
      toast(`${workspace.name} is now on the ${plan.name} plan`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // What would be over the limit on a smaller plan, so the owner knows before switching.
  const overLimits = (plan) =>
    [
      plan.members !== null && usage.members + usage.pendingInvites > plan.members && `${plural(usage.members + usage.pendingInvites, 'seat')} in use (${plan.members} included)`,
      plan.boards !== null && usage.boards > plan.boards && `${plural(usage.boards, 'board')} (${plan.boards} included)`,
      usage.storageBytes > plan.storageBytes && `${formatSize(usage.storageBytes)} of files (${limitSize(plan.storageBytes)} included)`,
    ].filter(Boolean);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">Workspace admin</p>
          <h1>{workspace.name}</h1>
          <p className="muted page-sub">
            {limits.name} plan · created {formatDate(workspace.createdAt.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => setDialog({ type: 'rename' })}>
            <Icon name="edit" size={16} /> Rename
          </button>
          <Link to={`/app/w/${workspaceId}/members`} className="btn btn-primary">
            <Icon name="users" size={16} /> Manage members
          </Link>
        </div>
      </header>

      <section className="admin-section">
        <h2 className="section-title">Usage</h2>
        <div className="usage-grid">
          <Meter
            icon="users"
            label="Seats"
            used={usage.members + usage.pendingInvites}
            limit={limits.members}
            format={(n) => n}
            note={usage.pendingInvites ? `${plural(usage.members, 'member')} and ${plural(usage.pendingInvites, 'pending invite')}` : plural(usage.members, 'member')}
          />
          <Meter icon="board" label="Boards" used={usage.boards} limit={limits.boards} format={(n) => n} note={`${plural(usage.tasks, 'task')}, ${usage.openTasks} open`} />
          <Meter icon="clip" label="File storage" used={usage.storageBytes} limit={limits.storageBytes} format={formatSize} formatLimit={limitSize} note={plural(usage.files, 'file')} />
          <div className="card usage-card">
            <div className="usage-head">
              <span className="stat-icon"><Icon name="timer" size={18} /></span>
              <span className="usage-label">Time tracked</span>
            </div>
            <p className="usage-value">{formatMinutes(usage.minutesLast30Days)}</p>
            <p className="faint small">In the last 30 days</p>
          </div>
        </div>
      </section>

      <section className="admin-section">
        <h2 className="section-title">{billingQuery.data?.enabled ? 'Plan and billing' : 'Plan'}</h2>
        {billingQuery.error ? (
          <p className="alert alert-error">{billingQuery.error.message}</p>
        ) : !billingQuery.data ? (
          <span className="spinner" />
        ) : billingQuery.data.enabled ? (
          <Billing workspaceId={workspaceId} billing={billingQuery.data} waiting={waiting} onWaitingChange={setWaiting} />
        ) : (
          <>
            <p className="muted small section-hint">
              Payments aren&apos;t enabled here, so switching plans is free. Moving to a smaller plan keeps everything you have; it only stops new
              boards, people or files beyond its limits.
            </p>
            <div className="plan-grid">
              {plans.map((plan) => {
                const current = plan.key === workspace.plan;
                return (
                  <article key={plan.key} className={`card plan-card ${current ? 'is-current' : ''}`}>
                    <header>
                      <h3>{plan.name}</h3>
                      {current && <span className="badge badge-accent">Current plan</span>}
                    </header>
                    <PlanFeatures plan={plan} />
                    {!current && (
                      <button
                        className="btn btn-secondary btn-sm btn-block"
                        onClick={() => {
                          const over = overLimits(plan);
                          if (over.length) setDialog({ type: 'downgrade', plan, over });
                          else switchPlan(plan);
                        }}
                      >
                        Switch to {plan.name}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section className="admin-section">
        <h2 className="section-title">Members</h2>
        <div className="card admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role</th>
                <th scope="col">Joined</th>
                <th scope="col">Last activity</th>
                <th scope="col" className="num">Open tasks</th>
                <th scope="col" className="num">Done, 30 days</th>
                <th scope="col" className="num">Time, 30 days</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <th scope="row">
                    <span className="admin-person">
                      <Avatar name={m.name} seed={m.email} url={m.avatarUrl} size="sm" />
                      <span>
                        <b>{m.name}{m.id === me?.id && <span className="badge">You</span>}</b>
                        <small className="faint">{m.email}</small>
                      </span>
                    </span>
                  </th>
                  <td><span className="badge role-badge">{m.role}</span></td>
                  <td className="muted">{formatDate(m.joinedAt.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td className="muted">{m.lastActiveAt ? timeAgo(m.lastActiveAt) : 'Nothing yet'}</td>
                  <td className="num">{m.openTasks}</td>
                  <td className="num">{m.completedLast30Days}</td>
                  <td className="num">{m.minutesLast30Days ? formatMinutes(m.minutesLast30Days) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-section">
        <h2 className="section-title">Audit log</h2>
        <p className="muted small section-hint">Everything that happened in this workspace, newest first, including boards that have since been deleted.</p>
        <AuditLog workspaceId={workspaceId} onOpenTask={(taskId, entry) => entry?.boardId && navigate(`/app/boards/${entry.boardId}?task=${taskId}`)} />
      </section>

      <section className="admin-section">
        <h2 className="section-title text-danger">Danger zone</h2>
        <div className="card danger-card">
          <div>
            <b>Delete this workspace</b>
            <p className="muted small">
              Deletes every board, task, comment and file in {workspace.name}, for everyone in it. This can&apos;t be undone.
              {workspaces.length <= 1 && ' It’s your only workspace, so create another one first.'}
            </p>
          </div>
          <button className="btn btn-danger" disabled={workspaces.length <= 1} onClick={() => setDialog({ type: 'delete' })}>
            Delete workspace
          </button>
        </div>
      </section>

      {dialog?.type === 'rename' && (
        <PromptDialog
          title="Rename workspace"
          label="Workspace name"
          initial={workspace.name}
          submitLabel="Save"
          onSubmit={async (name) => {
            await api.renameWorkspace(workspaceId, name);
            await refresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'downgrade' && (
        <ConfirmDialog
          title={`Switch to ${dialog.plan.name}?`}
          description={`This workspace is over the ${dialog.plan.name} plan's limits: ${dialog.over.join('; ')}. Nothing is removed, but nobody can add more until it's back under them.`}
          confirmLabel={`Switch to ${dialog.plan.name}`}
          onConfirm={() => switchPlan(dialog.plan)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'delete' && (
        <DeleteWorkspaceDialog
          workspace={workspace}
          onDeleted={async () => {
            const next = workspaces.find((w) => w.id !== workspaceId);
            setWorkspaceId(next.id);
            client.removeQueries({ queryKey: keys.admin(workspaceId) });
            await client.invalidateQueries({ queryKey: keys.workspaces });
            toast(`${workspace.name} was deleted`, 'success');
            navigate(`/app/w/${next.id}`);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

// A usage bar against a plan limit; amber from 80%, red at the limit.
function Meter({ icon, label, used, limit, format, formatLimit = format, note }) {
  const pct = limit === null ? 0 : Math.min(100, (used / limit) * 100);
  const tone = limit === null ? '' : used >= limit ? 'is-full' : pct >= 80 ? 'is-near' : '';
  return (
    <div className={`card usage-card ${tone}`}>
      <div className="usage-head">
        <span className="stat-icon"><Icon name={icon} size={18} /></span>
        <span className="usage-label">{label}</span>
        {tone === 'is-full' && <span className="badge badge-danger">{used > limit ? 'Over limit' : 'At limit'}</span>}
      </div>
      <p className="usage-value">
        {format(used)}
        <span className="muted"> {limit === null ? '· unlimited' : `of ${formatLimit(limit)}`}</span>
      </p>
      {limit !== null && (
        <div className="progress usage-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}>
          <span style={{ width: `${Math.max(pct, used ? 2 : 0)}%` }} />
        </div>
      )}
      <p className="faint small">{note}</p>
    </div>
  );
}

function AuditLog({ workspaceId, onOpenTask }) {
  const { data, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } = useAuditLog(workspaceId);
  if (isPending) return <span className="spinner" />;
  const entries = data.pages.flat();
  return (
    <div className="card audit-log">
      <ActivityList entries={entries} onOpenTask={onOpenTask} showBoard />
      {hasNextPage && (
        <button className="btn btn-secondary btn-sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? 'Loading…' : 'Show older'}
        </button>
      )}
    </div>
  );
}

// Typing the workspace's name confirms it, so a stray click can't delete it.
function DeleteWorkspaceDialog({ workspace, onDeleted, onClose }) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function remove(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.deleteWorkspace(workspace.id);
      onClose();
      await onDeleted();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Dialog title={`Delete ${workspace.name}?`} description="Every board, task, comment, file and time entry in it is deleted for everyone. This can't be undone." onClose={onClose}>
      <form onSubmit={remove} style={{ marginTop: 16 }}>
        <Field label={`Type “${workspace.name}” to confirm`} error={error}>
          {(props) => <input {...props} className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}
        </Field>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy || typed.trim() !== workspace.name}>
            Delete workspace
          </button>
        </div>
      </form>
    </Dialog>
  );
}
