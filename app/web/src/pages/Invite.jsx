// /invite/:token: shows who invited you, then lets you accept (signing up or in first).
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import Icon from '../components/Icon.jsx';
import { Logo } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { keys, useMe } from '../lib/queries.js';

export default function Invite() {
  const { token } = useParams();
  const { data: me, isPending: mePending } = useMe();
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const navigate = useNavigate();
  const here = `/invite/${encodeURIComponent(token)}`;

  useEffect(() => {
    api.lookupInvite(token).then(setInvite, (err) => setError(err.message));
  }, [token]);

  async function accept() {
    setBusy(true);
    setError('');
    try {
      const { workspaceId } = await api.acceptInvite(token);
      await client.invalidateQueries({ queryKey: keys.workspaces });
      navigate(`/app/w/${workspaceId}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function switchAccount() {
    await api.logout().catch(() => {});
    client.setQueryData(keys.me, null);
    navigate(`/login?next=${encodeURIComponent(here)}`);
  }

  const loading = mePending || (!invite && !error);
  const matches = me && invite && me.email === invite.email;

  return (
    <div className="invite-page">
      <Logo />
      <div className="card invite-panel">
        {loading && <span className="spinner" />}

        {!loading && !invite && (
          <>
            <span className="empty-icon"><Icon name="mail" size={22} /></span>
            <h1>This invite doesn&apos;t work</h1>
            <p className="muted">{error}</p>
            <Link to="/app" className="btn btn-secondary">Go to Tasklane</Link>
          </>
        )}

        {!loading && invite && (
          <>
            <span className="ws-mark invite-mark">{invite.workspaceName[0]?.toUpperCase()}</span>
            <h1>Join {invite.workspaceName}</h1>
            <p className="muted">
              <b>{invite.invitedBy?.name ?? 'A teammate'}</b> invited <b>{invite.email}</b> to join as {invite.role === 'owner' ? 'an' : 'a'}{' '}
              <b>{invite.role}</b>.
            </p>

            {invite.accepted ? (
              <p className="alert alert-error">This invite has already been used.</p>
            ) : invite.expired ? (
              <p className="alert alert-error">This invite has expired. Ask {invite.invitedBy?.name ?? 'the owner'} to send a new one.</p>
            ) : !me ? (
              <div className="invite-actions">
                <Link to={`/signup?email=${encodeURIComponent(invite.email)}&next=${encodeURIComponent(here)}`} className="btn btn-primary btn-block">
                  Create an account to join
                </Link>
                <Link to={`/login?next=${encodeURIComponent(here)}`} className="btn btn-secondary btn-block">
                  I already have an account
                </Link>
              </div>
            ) : matches ? (
              <button className="btn btn-primary btn-lg btn-block" onClick={accept} disabled={busy}>
                {busy ? 'Joining…' : `Join ${invite.workspaceName}`}
              </button>
            ) : (
              <>
                <p className="alert alert-error">
                  You&apos;re signed in as {me.email}. This invite is for {invite.email}.
                </p>
                <button className="btn btn-secondary btn-block" onClick={switchAccount}>
                  Sign in with {invite.email}
                </button>
              </>
            )}
            {error && invite && <p className="alert alert-error">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
