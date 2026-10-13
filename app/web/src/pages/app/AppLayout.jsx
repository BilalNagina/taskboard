import { createContext, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import Icon from '../../components/Icon.jsx';
import NotificationBell from '../../components/NotificationBell.jsx';
import { TimerPill } from '../../components/Timer.jsx';
import { useToast } from '../../components/Toaster.jsx';
import Tour from '../../components/Tour.jsx';
import { Avatar, Dropdown, Logo, PromptDialog } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { keys, useBoards, useMe, useMyInvites, useWorkspaces } from '../../lib/queries.js';
import { applyTheme } from '../../lib/theme.js';
import NewBoardDialog from './NewBoardDialog.jsx';

// The workspace the sidebar shows. Pages set it from the URL (workspace page) or from
// the open board; it's remembered for the next visit.
const WorkspaceContext = createContext(null);
const LAST_WORKSPACE = 'tasklane-workspace';

export function useCurrentWorkspace() {
  return useContext(WorkspaceContext);
}

export function rememberedWorkspace() {
  try {
    return Number(localStorage.getItem(LAST_WORKSPACE)) || null;
  } catch {
    return null;
  }
}

export default function AppLayout() {
  const [workspaceId, setWorkspaceIdState] = useState(rememberedWorkspace);
  const [navOpen, setNavOpen] = useState(false);
  const [touring, setTouring] = useState(false);
  const { data: me } = useMe();
  const client = useQueryClient();
  const location = useLocation();

  // New accounts see the welcome tour once.
  useEffect(() => {
    if (me && !me.onboardedAt) setTouring(true);
  }, [me?.id]);

  async function endTour() {
    setTouring(false);
    if (me.onboardedAt) return;
    try {
      const { user } = await api.updateProfile({ onboarded: true });
      client.setQueryData(keys.me, user);
    } catch {
      // It'll show again next time; nothing else depends on it.
    }
  }

  const setWorkspaceId = (id) => {
    setWorkspaceIdState(id);
    try {
      localStorage.setItem(LAST_WORKSPACE, String(id));
    } catch {
      // Not remembering the workspace is fine.
    }
  };

  // Close the mobile menu after navigating.
  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <WorkspaceContext.Provider value={{ workspaceId, setWorkspaceId, startTour: () => setTouring(true) }}>
      <div className={`app ${navOpen ? 'nav-open' : ''}`}>
        <Sidebar onClose={() => setNavOpen(false)} />
        <div className="app-scrim" onClick={() => setNavOpen(false)} />
        <div className="app-main">
          <header className="app-mobilebar">
            <button className="icon-btn" onClick={() => setNavOpen(true)} aria-label="Open menu">
              <Icon name="menu" size={20} />
            </button>
            <Logo to="/app" />
            <span className="app-mobilebar-end">
              <TimerPill compact />
              <NotificationBell />
            </span>
          </header>
          <PendingInvites onJoined={setWorkspaceId} />
          <Outlet />
        </div>
      </div>
      {touring && me && <Tour name={me.name.split(' ')[0]} onDone={endTour} />}
    </WorkspaceContext.Provider>
  );
}

function Sidebar({ onClose }) {
  const { workspaceId, setWorkspaceId } = useCurrentWorkspace();
  const { data: workspaces = [] } = useWorkspaces();
  const workspace = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0];
  const { data: boards = [] } = useBoards(workspace?.id);
  const [dialog, setDialog] = useState(null);
  const navigate = useNavigate();
  const client = useQueryClient();
  const canEdit = workspace && workspace.role !== 'viewer';

  async function createWorkspace(name) {
    const created = await api.createWorkspace(name);
    await client.invalidateQueries({ queryKey: keys.workspaces });
    setWorkspaceId(created.id);
    navigate(`/app/w/${created.id}`);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <Logo to="/app" />
        <div className="sidebar-head-actions">
          <NotificationBell />
          <button className="icon-btn sidebar-close" onClick={onClose} aria-label="Close menu">
            <Icon name="x" />
          </button>
        </div>
      </div>

      <Dropdown
        className="ws-switcher"
        trigger={({ toggle, open }) => (
          <button className="ws-button" onClick={toggle} aria-expanded={open} data-tour="workspace">
            <span className="ws-mark">{workspace?.name?.[0]?.toUpperCase() ?? '·'}</span>
            <span className="ws-name">
              <b>{workspace?.name ?? 'Loading…'}</b>
              <small>{workspace ? `${workspace.plan[0].toUpperCase()}${workspace.plan.slice(1)} plan · ${workspace.role}` : ''}</small>
            </span>
            <Icon name="chevronDown" size={16} />
          </button>
        )}
      >
        <div className="menu-label">Workspaces</div>
        {workspaces.map((w) => (
          <button
            key={w.id}
            className="menu-item"
            onClick={() => {
              setWorkspaceId(w.id);
              navigate(`/app/w/${w.id}`);
            }}
          >
            <span className="ws-mark sm">{w.name[0].toUpperCase()}</span>
            <span style={{ flex: 1 }}>{w.name}</span>
            {w.id === workspace?.id && <Icon name="check" size={16} />}
          </button>
        ))}
        <hr />
        <button className="menu-item" onClick={() => setDialog('workspace')}>
          <Icon name="plus" size={16} /> New workspace
        </button>
      </Dropdown>

      <nav className="sidebar-nav" aria-label="Main">
        {workspace && (
          <>
            <NavLink to={`/app/w/${workspace.id}`} end className="nav-item">
              <Icon name="home" /> Boards
            </NavLink>
            <div className="nav-group" data-tour="views">
              <NavLink to={`/app/w/${workspace.id}/dashboard`} className="nav-item">
                <Icon name="chart" /> Dashboard
              </NavLink>
              <NavLink to={`/app/w/${workspace.id}/calendar`} className="nav-item">
                <Icon name="calendar" /> Calendar
              </NavLink>
              <NavLink to={`/app/w/${workspace.id}/search`} className="nav-item">
                <Icon name="search" /> Search
              </NavLink>
            </div>
            <NavLink to={`/app/w/${workspace.id}/timesheet`} className="nav-item" data-tour="timesheet">
              <Icon name="timer" /> Timesheet
            </NavLink>
            <NavLink to={`/app/w/${workspace.id}/members`} className="nav-item" data-tour="members">
              <Icon name="users" /> Members
              <span className="nav-count">{workspace.memberCount}</span>
            </NavLink>
          </>
        )}
        <NavLink to="/app/settings" className="nav-item">
          <Icon name="settings" /> Settings
        </NavLink>
      </nav>

      <div className="sidebar-section">
        <div data-tour="boards">
          <div className="sidebar-section-head">
            <span>Boards</span>
            {canEdit && (
              <button className="icon-btn" onClick={() => setDialog('board')} aria-label="New board" title="New board">
                <Icon name="plus" size={16} />
              </button>
            )}
          </div>
          <nav className="sidebar-boards" aria-label="Boards">
            {boards.map((board) => (
              <NavLink key={board.id} to={`/app/boards/${board.id}`} className="nav-item">
                <span className="board-dot" />
                <span className="nav-text">{board.name}</span>
                {board.openCount > 0 && <span className="nav-count">{board.openCount}</span>}
              </NavLink>
            ))}
            {workspace && boards.length === 0 && <p className="faint small sidebar-empty">No boards yet</p>}
          </nav>
        </div>
      </div>

      <TimerPill />
      <UserMenu />

      {dialog === 'workspace' && (
        <PromptDialog
          title="New workspace"
          description="A workspace holds boards and the people who work on them."
          label="Workspace name"
          submitLabel="Create workspace"
          onSubmit={createWorkspace}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'board' && <NewBoardDialog workspace={workspace} onClose={() => setDialog(null)} />}
    </aside>
  );
}

const THEMES = [
  ['system', 'monitor', 'System'],
  ['light', 'sun', 'Light'],
  ['dark', 'moon', 'Dark'],
];

function UserMenu() {
  const { data: user } = useMe();
  const { startTour } = useCurrentWorkspace();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  async function setTheme(theme) {
    applyTheme(theme);
    try {
      const { user: updated } = await api.updateProfile({ theme });
      client.setQueryData(keys.me, updated);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function signOut() {
    await api.logout().catch(() => {});
    client.setQueryData(keys.me, null);
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    navigate('/login');
  }

  if (!user) return null;
  return (
    <Dropdown
      className="user-menu"
      align="up"
      trigger={({ toggle, open }) => (
        <button className="user-button" onClick={toggle} aria-expanded={open}>
          <Avatar name={user.name} seed={user.email} url={user.avatarUrl} />
          <span className="user-text">
            <b>{user.name}</b>
            <small>{user.email}</small>
          </span>
          <Icon name="more" size={16} />
        </button>
      )}
    >
      <NavLink to="/app/settings" className="menu-item">
        <Icon name="user" size={16} /> Profile and settings
      </NavLink>
      <button className="menu-item" onClick={startTour}>
        <Icon name="compass" size={16} /> Take the tour
      </button>
      <hr />
      <div className="menu-label">Theme</div>
      <div className="theme-picker" onClick={(e) => e.stopPropagation()}>
        {THEMES.map(([value, icon, label]) => (
          <button key={value} className={user.theme === value ? 'active' : ''} onClick={() => setTheme(value)} aria-pressed={user.theme === value}>
            <Icon name={icon} size={15} /> {label}
          </button>
        ))}
      </div>
      <hr />
      <button className="menu-item danger" onClick={signOut}>
        <Icon name="logout" size={16} /> Sign out
      </button>
    </Dropdown>
  );
}

function PendingInvites({ onJoined }) {
  const { data: invites = [] } = useMyInvites();
  const [busy, setBusy] = useState(null);
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  if (!invites.length) return null;

  async function respond(invite, join) {
    setBusy(invite.id);
    try {
      if (join) {
        const { workspaceId } = await api.acceptMyInvite(invite.id);
        await client.invalidateQueries({ queryKey: keys.workspaces });
        onJoined(workspaceId);
        toast(`You joined ${invite.workspaceName}`, 'success');
        navigate(`/app/w/${workspaceId}`);
      } else {
        await api.declineMyInvite(invite.id);
        toast('Invitation declined');
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(null);
      await client.invalidateQueries({ queryKey: keys.myInvites });
    }
  }

  return (
    <div className="invite-banners">
      {invites.map((invite) => (
        <div key={invite.id} className="invite-banner" role="status">
          <span className="ws-mark sm">{invite.workspaceName[0]?.toUpperCase()}</span>
          <p>
            <b>{invite.invitedBy?.name ?? 'A teammate'}</b> invited you to join <b>{invite.workspaceName}</b> as{' '}
            {invite.role === 'owner' ? 'an' : 'a'} {invite.role}.
          </p>
          <div className="invite-banner-actions">
            <button className="btn btn-primary btn-sm" onClick={() => respond(invite, true)} disabled={busy === invite.id}>
              Join
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => respond(invite, false)} disabled={busy === invite.id}>
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
