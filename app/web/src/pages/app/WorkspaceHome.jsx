import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { EmptyState, PromptDialog } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { keys, useBoards, useMe, useWorkspaces } from '../../lib/queries.js';
import { useCurrentWorkspace } from './AppLayout.jsx';

export default function WorkspaceHome() {
  const workspaceId = Number(useParams().workspaceId);
  const { setWorkspaceId } = useCurrentWorkspace();
  const { data: user } = useMe();
  const { data: workspaces, isPending } = useWorkspaces();
  const { data: boards = [], isPending: boardsPending } = useBoards(workspaceId);
  const [dialog, setDialog] = useState(null);
  const client = useQueryClient();
  const navigate = useNavigate();

  const workspace = workspaces?.find((w) => w.id === workspaceId);
  useEffect(() => {
    if (workspace) setWorkspaceId(workspace.id);
  }, [workspace?.id]);

  if (isPending) return <div className="page-loading"><span className="spinner" /></div>;
  if (!workspace) {
    return (
      <div className="page">
        <EmptyState icon="board" title="Workspace not found" action={<Link to="/app" className="btn btn-primary">Go to my workspace</Link>}>
          It may have been deleted, or you no longer have access.
        </EmptyState>
      </div>
    );
  }

  const canEdit = workspace.role !== 'viewer';
  const totals = boards.reduce((sum, b) => ({ tasks: sum.tasks + b.taskCount, open: sum.open + b.openCount }), { tasks: 0, open: 0 });

  async function createBoard(name) {
    const board = await api.createBoard(workspace.id, name);
    await client.invalidateQueries({ queryKey: keys.boards(workspace.id) });
    navigate(`/app/boards/${board.id}`);
  }

  async function rename(name) {
    await api.renameWorkspace(workspace.id, name);
    await client.invalidateQueries({ queryKey: keys.workspaces });
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">Good {greeting()}, {user?.name.split(' ')[0]}</p>
          <h1>{workspace.name}</h1>
          <p className="muted page-sub">
            {workspace.memberCount} {workspace.memberCount === 1 ? 'member' : 'members'} · {boards.length}{' '}
            {boards.length === 1 ? 'board' : 'boards'} · {totals.open} open {totals.open === 1 ? 'task' : 'tasks'}
          </p>
        </div>
        <div className="page-actions">
          {workspace.role === 'owner' && (
            <button className="btn btn-secondary" onClick={() => setDialog('rename')}>
              <Icon name="edit" size={16} /> Rename
            </button>
          )}
          {canEdit && (
            <button className="btn btn-primary" onClick={() => setDialog('board')}>
              <Icon name="plus" size={16} /> New board
            </button>
          )}
        </div>
      </header>

      {!canEdit && <p className="notice"><Icon name="eye" size={16} /> You have view-only access to this workspace.</p>}

      {!boardsPending && boards.length === 0 ? (
        <EmptyState
          icon="board"
          title="No boards yet"
          action={canEdit && <button className="btn btn-primary" onClick={() => setDialog('board')}>Create your first board</button>}
        >
          Boards hold your tasks. Make one per project, client or team.
        </EmptyState>
      ) : (
        <div className="board-grid">
          {boards.map((board) => {
            const done = board.taskCount - board.openCount;
            const pct = board.taskCount ? Math.round((done / board.taskCount) * 100) : 0;
            return (
              <Link key={board.id} to={`/app/boards/${board.id}`} className="board-card">
                <div className="board-card-top">
                  <span className="board-card-icon"><Icon name="board" size={18} /></span>
                  <Icon name="arrowRight" size={16} className="board-card-arrow" />
                </div>
                <h3>{board.name}</h3>
                <p className="muted small">
                  {board.taskCount === 0 ? 'No tasks yet' : `${board.openCount} open · ${done} done`}
                </p>
                <div className="progress" aria-label={`${pct}% complete`}>
                  <span style={{ width: `${pct}%` }} />
                </div>
              </Link>
            );
          })}
          {canEdit && (
            <button className="board-card board-card-new" onClick={() => setDialog('board')}>
              <Icon name="plus" size={20} />
              <span>New board</span>
            </button>
          )}
        </div>
      )}

      {dialog === 'board' && (
        <PromptDialog title="New board" description={`In ${workspace.name}`} label="Board name" submitLabel="Create board" onSubmit={createBoard} onClose={() => setDialog(null)} />
      )}
      {dialog === 'rename' && (
        <PromptDialog title="Rename workspace" label="Workspace name" initial={workspace.name} submitLabel="Save" onSubmit={rename} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}
