import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/Toaster.jsx';
import { Avatar, ConfirmDialog, Field } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { timeAgo } from '../../lib/format.js';
import { keys, useInvites, useMe, useMembers, useWorkspaces } from '../../lib/queries.js';
import { useCurrentWorkspace } from './AppLayout.jsx';

const ROLE_INFO = {
  owner: 'Manages members, settings and boards',
  member: 'Creates and edits boards and tasks',
  viewer: 'Sees everything and can comment',
};

export default function Members() {
  const workspaceId = Number(useParams().workspaceId);
  const { setWorkspaceId } = useCurrentWorkspace();
  const { data: me } = useMe();
  const { data: workspaces = [] } = useWorkspaces();
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const isOwner = workspace?.role === 'owner';
  const { data: members = [], isPending } = useMembers(workspaceId);
  const { data: invites = [] } = useInvites(workspaceId, isOwner);
  const [confirm, setConfirm] = useState(null);
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (workspace) setWorkspaceId(workspace.id);
  }, [workspace?.id]);

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.members(workspaceId) }),
      client.invalidateQueries({ queryKey: keys.invites(workspaceId) }),
      client.invalidateQueries({ queryKey: keys.workspaces }),
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

  if (!workspace) return <div className="page-loading"><span className="spinner" /></div>;

  return (
    <div className="page page-narrow">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={`/app/w/${workspaceId}`}>{workspace.name}</Link>
        <Icon name="chevronRight" size={14} />
        <span>Members</span>
      </nav>
      <header className="page-head">
        <div>
          <h1>Members</h1>
          <p className="muted page-sub">
            {members.length} {members.length === 1 ? 'person' : 'people'} in {workspace.name}
          </p>
        </div>
      </header>

      {isOwner && <InviteForm workspaceId={workspaceId} onInvited={refresh} />}

      <section className="card member-list">
        {isPending && <div className="page-loading"><span className="spinner" /></div>}
        {members.map((member) => {
          const isMe = member.id === me?.id;
          return (
            <div key={member.id} className="member-row">
              <Avatar name={member.name} seed={member.email} url={member.avatarUrl} />
              <div className="member-who">
                <b>
                  {member.name} {isMe && <span className="badge">You</span>}
                </b>
                <span className="faint small">{member.email}</span>
              </div>
              {isOwner && !isMe ? (
                <select
                  className="input input-sm role-select"
                  value={member.role}
                  onChange={(e) => run(() => api.setMemberRole(workspaceId, member.id, e.target.value), `${member.name} is now ${e.target.value === 'owner' ? 'an' : 'a'} ${e.target.value}`)}
                  aria-label={`Role for ${member.name}`}
                  title={ROLE_INFO[member.role]}
                >
                  <option value="owner">Owner</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              ) : (
                <span className="badge role-badge" title={ROLE_INFO[member.role]}>{member.role}</span>
              )}
              {(isOwner || isMe) && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setConfirm(
                      isMe
                        ? { title: `Leave ${workspace.name}?`, description: "You'll lose access to its boards until someone invites you again.", label: 'Leave workspace', action: async () => {
                            await api.removeMember(workspaceId, member.id);
                            await client.invalidateQueries({ queryKey: keys.workspaces });
                            navigate('/app');
                          } }
                        : { title: `Remove ${member.name}?`, description: 'They lose access to every board in this workspace and are unassigned from its tasks.', label: 'Remove', action: () => run(() => api.removeMember(workspaceId, member.id), `${member.name} removed`) },
                    )
                  }
                >
                  {isMe ? 'Leave' : 'Remove'}
                </button>
              )}
            </div>
          );
        })}
      </section>

      {isOwner && invites.length > 0 && (
        <section className="invites">
          <h2 className="section-title">Pending invitations</h2>
          <p className="faint small section-hint">
            Invited people can join from the link, or from a banner in Tasklane once they sign in with the invited email.
            Resending creates a new link and the old one stops working.
          </p>
          <div className="card member-list">
            {invites.map((invite) => (
              <div key={invite.id} className="member-row">
                <span className="avatar invite-avatar"><Icon name="mail" size={14} /></span>
                <div className="member-who">
                  <b>{invite.email}</b>
                  <span className="faint small">
                    Invited as {invite.role} {timeAgo(invite.createdAt)}
                    {invite.expired ? ' · expired' : ''}
                  </span>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={async () => {
                    const result = await run(() => api.resendInvite(invite.id));
                    if (result) await copyLink(result.link, toast, 'New link copied. The previous link no longer works.');
                  }}
                >
                  Resend and copy link
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => run(() => api.revokeInvite(invite.id), 'Invitation revoked')}>
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="roles-help">
        <h2 className="section-title">What each role can do</h2>
        <ul>
          {Object.entries(ROLE_INFO).map(([role, text]) => (
            <li key={role}>
              <span className="badge role-badge">{role}</span> {text}
            </li>
          ))}
        </ul>
      </section>

      {confirm && (
        <ConfirmDialog title={confirm.title} description={confirm.description} confirmLabel={confirm.label} danger onConfirm={confirm.action} onClose={() => setConfirm(null)} />
      )}
    </div>
  );
}

async function copyLink(link, toast, message) {
  try {
    await navigator.clipboard.writeText(link);
    toast(message, 'success');
  } catch {
    window.prompt('Copy this invite link', link);
  }
}

function InviteForm({ workspaceId, onInvited }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(null);
  const toast = useToast();

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.invite(workspaceId, email, role);
      setSent(result);
      setEmail('');
      await onInvited();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card invite-card">
      <h2 className="section-title">Invite people</h2>
      <form className="invite-form" onSubmit={submit}>
        <Field label="Email" error={error}>
          {(props) => <input {...props} type="email" className="input" placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />}
        </Field>
        <Field label="Role">
          {(props) => (
            <select {...props} className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
              <option value="owner">Owner</option>
            </select>
          )}
        </Field>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          <Icon name="mail" size={16} /> Send invite
        </button>
      </form>
      <p className="faint small">{ROLE_INFO[role]}. Invitations last 7 days.</p>
      {sent && (
        <div className="alert alert-success invite-sent">
          <span>
            Invitation sent to <b>{sent.invite.email}</b>. You can also share the link yourself.
          </span>
          <button className="btn btn-secondary btn-sm" onClick={() => copyLink(sent.link, toast, 'Invite link copied')}>
            Copy link
          </button>
        </div>
      )}
    </section>
  );
}
