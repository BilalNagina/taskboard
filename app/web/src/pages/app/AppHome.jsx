import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router';
import { EmptyState, PromptDialog } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { keys, useWorkspaces } from '../../lib/queries.js';
import { rememberedWorkspace } from './AppLayout.jsx';

// /app opens the workspace used last time, or the first one.
export default function AppHome() {
  const { data: workspaces, isPending, error } = useWorkspaces();
  const [creating, setCreating] = useState(false);
  const client = useQueryClient();
  const navigate = useNavigate();

  if (isPending) return <div className="page-loading"><span className="spinner" /></div>;
  if (error) return <div className="page"><p className="alert alert-error">{error.message}</p></div>;

  const last = rememberedWorkspace();
  const target = workspaces.find((w) => w.id === last) ?? workspaces[0];
  if (target) return <Navigate to={`/app/w/${target.id}`} replace />;

  return (
    <div className="page">
      <EmptyState
        icon="users"
        title="You're not in any workspace"
        action={<button className="btn btn-primary" onClick={() => setCreating(true)}>Create a workspace</button>}
      >
        Create one to start adding boards, or ask a teammate to invite you to theirs.
      </EmptyState>
      {creating && (
        <PromptDialog
          title="New workspace"
          label="Workspace name"
          submitLabel="Create workspace"
          onSubmit={async (name) => {
            const created = await api.createWorkspace(name);
            await client.invalidateQueries({ queryKey: keys.workspaces });
            navigate(`/app/w/${created.id}`);
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
