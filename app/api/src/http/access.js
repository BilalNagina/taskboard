import { roleAtLeast } from '../data/index.js';
import { HttpError } from './errors.js';

// Permission checks. Not being a member answers 404 rather than 403, so outsiders can't
// even learn that a board or task exists. Members with too low a role get 403.
export function createAccess(repo) {
  function check(access, needed, what) {
    if (!access?.role) throw new HttpError(404, `${what} not found`);
    if (!roleAtLeast(access.role, needed)) {
      throw new HttpError(403, needed === 'owner' ? 'only workspace owners can do that' : "viewers can't make changes");
    }
    return access;
  }

  return {
    workspace: async (req, workspaceId, needed = 'viewer') =>
      check({ role: await repo.workspaceRole(req.user.id, workspaceId) }, needed, 'workspace'),
    board: async (req, boardId, needed = 'viewer') => check(await repo.boardAccess(req.user.id, boardId), needed, 'board'),
    task: async (req, taskId, needed = 'viewer') => check(await repo.taskAccess(req.user.id, taskId), needed, 'task'),
    attachment: async (req, attachmentId, needed = 'viewer') =>
      check(await repo.attachmentAccess(req.user.id, attachmentId), needed, 'attachment'),
  };
}
