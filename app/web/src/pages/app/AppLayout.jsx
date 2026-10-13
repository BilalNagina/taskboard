import { createContext, Suspense, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import CommandPalette from '../../components/CommandPalette.jsx';
import ErrorBoundary from '../../components/ErrorBoundary.jsx';
import Icon from '../../components/Icon.jsx';
import NotificationBell from '../../components/NotificationBell.jsx';
import ShortcutsDialog from '../../components/ShortcutsDialog.jsx';
import { TimerPill } from '../../components/Timer.jsx';
import { useToast } from '../../components/Toaster.jsx';
import Tour from '../../components/Tour.jsx';
import { Avatar, Dropdown, Logo, PromptDialog } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { modKey } from '../../lib/format.js';
import { useLiveStatus, useLiveUpdates } from '../../lib/live.js';
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

// Saves the theme to the account (the page switches straight away).
function useSetTheme() {
  const client = useQueryClient();
  const toast = useToast();
  return async (theme) => {
    applyTheme(theme);
    try {
      const { user: updated } = await api.updateProfile({ theme });
      client.setQueryData(keys.me, updated);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

function useSignOut() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await api.logout().catch(() => {});
    client.setQueryData(keys.me, null);
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    navigate('/login');
  };
}

// Single-letter shortcuts are ignored while typing, and while a dialog, the palette or
// the tour is open.
const isTyping = (el) => el?.closest?.('input, textarea, select, [contenteditable="true"]');
const overlayOpen = () => document.querySelector('.dialog-backdrop, .palette-backdrop, .tour');

// "G then <letter>" pages; A (admin) is checked against the role where it's used.
const GO_TO = { b: '', d: '/dashboard', c: '/calendar', s: '/search', t: '/timesheet', m: '/members', a: '/admin' };

export default function AppLayout() {
  const [workspaceId, setWorkspaceIdState] = useState(rememberedWorkspace);
  const [navOpen, setNavOpen] = useState(false);
  const [touring, setTouring] = useState(false);
  const [palette, setPalette] = useState(null); // null, or { mode: 'search' | 'task' }
  const [overlay, setOverlay] = useState(null); // 'shortcuts' | 'board'
  const { data: me } = useMe();
  const { data: workspaces = [] } = useWorkspaces();
  const workspace = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0];
  const { data: boards = [] } = useBoards(workspace?.id);
  const client = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const setTheme = useSetTheme();
  const signOut = useSignOut();
  const boardId = Number(location.pathname.match(/^\/app\/boards\/(\d+)/)?.[1]) || null;
  const taskId = Number(new URLSearchParams(location.search).get('task')) || null;
  useLiveUpdates(boardId);

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

  // Keyboard shortcuts. Re-registered each render so they always see the current page.
  useEffect(() => {
    let pendingG = null;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((open) => (open ? null : { mode: 'search' }));
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || overlayOpen()) return;
      const key = e.key.toLowerCase();
      if (pendingG) {
        clearTimeout(pendingG);
        pendingG = null;
        const path = GO_TO[key];
        if (path !== undefined && workspace && (key !== 'a' || workspace.role === 'owner')) {
          e.preventDefault();
          navigate(`/app/w/${workspace.id}${path}`);
        }
        return;
      }
      if (key === 'g') {
        pendingG = setTimeout(() => (pendingG = null), 1500);
      } else if (e.key === '?') {
        e.preventDefault();
        setOverlay('shortcuts');
      } else if (e.key === '/') {
        e.preventDefault();
        setPalette({ mode: 'search' });
      } else if (key === 'c' && boardId && workspace?.role !== 'viewer') {
        e.preventDefault();
        setPalette({ mode: 'task' });
      } else if (key === 'f' && boardId) {
        const filter = document.querySelector('.filter-search input');
        if (filter) {
          e.preventDefault();
          filter.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(pendingG);
    };
  });

  const context = {
    workspaceId,
    setWorkspaceId,
    startTour: () => setTouring(true),
    openPalette: () => setPalette({ mode: 'search' }),
    showShortcuts: () => setOverlay('shortcuts'),
    setTheme,
    signOut,
  };

  return (
    <WorkspaceContext.Provider value={context}>
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
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<div className="page-loading"><span className="spinner" /></div>}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
      {touring && me && <Tour name={me.name.split(' ')[0]} onDone={endTour} />}
      {palette && (
        <CommandPalette
          initialMode={palette.mode}
          workspace={workspace}
          workspaces={workspaces}
          boards={boards}
          boardId={boardId}
          taskId={taskId}
          onClose={() => setPalette(null)}
          actions={{
            newBoard: () => setOverlay('board'),
            showShortcuts: () => setOverlay('shortcuts'),
            startTour: () => setTouring(true),
            setTheme,
            signOut,
            switchWorkspace: (id) => {
              setWorkspaceId(id);
              navigate(`/app/w/${id}`);
            },
          }}
        />
      )}
      {overlay === 'shortcuts' && <ShortcutsDialog onClose={() => setOverlay(null)} />}
      {overlay === 'board' && workspace && <NewBoardDialog workspace={workspace} onClose={() => setOverlay(null)} />}
    </WorkspaceContext.Provider>
  );
}

function Sidebar({ onClose }) {
  const { workspaceId, setWorkspaceId, openPalette } = useCurrentWorkspace();
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

      <button className="palette-trigger" onClick={openPalette} data-tour="palette">
        <Icon name="search" size={16} />
        <span>Search or jump to…</span>
        <kbd>{modKey} K</kbd>
      </button>

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
            {workspace.role === 'owner' && (
              <NavLink to={`/app/w/${workspace.id}/admin`} className="nav-item">
                <Icon name="shield" /> Admin
              </NavLink>
            )}
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

      <LiveStatus />
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

// Only says something when live updates have been down for a few seconds, so a quick
// reconnect (a deploy, a network blip) goes unnoticed.
function LiveStatus() {
  // Keyed on connected-or-not: retries flip between "connecting" and "closed", which
  // mustn't restart the wait.
  const connected = useLiveStatus() === 'open';
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (connected) return setShow(false);
    const timer = setTimeout(() => setShow(true), 4000);
    return () => clearTimeout(timer);
  }, [connected]);
  if (!show) return null;
  return (
    <p className="live-status" role="status">
      <span className="spinner" style={{ width: 12, height: 12 }} /> Reconnecting… others&apos; changes appear once it&apos;s back.
    </p>
  );
}

const THEMES = [
  ['system', 'monitor', 'System'],
  ['light', 'sun', 'Light'],
  ['dark', 'moon', 'Dark'],
];

function UserMenu() {
  const { data: user } = useMe();
  const { startTour, showShortcuts, setTheme, signOut } = useCurrentWorkspace();

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
      <button className="menu-item" onClick={showShortcuts}>
        <Icon name="zap" size={16} /> Keyboard shortcuts
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
