import { roleAtLeast } from '../data/index.js';
import { HttpError } from './errors.js';

// Permission checks. Not being a member answers 404 rather than 403, so outsiders can't
// even learn that a board or task exists. Members with too low a role get 403.
// Each check returns the access row: role plus workspace/board/task ids for logging. It
// also notes those ids on the request, so a successful change can be announced live.
export function createAccess(repo) {
  function check(req, access, needed, what) {
    if (!access?.role) throw new HttpError(404, `${what} not found`);
    if (!roleAtLeast(access.role, needed)) {
      throw new HttpError(403, needed === 'owner' ? 'only workspace owners can do that' : "viewers can't make changes");
    }
    req.live = { workspaceId: access.workspaceId, boardId: access.boardId ?? null, taskId: access.taskId ?? null };
    return access;
  }

  const checker = (lookup, what) => async (req, id, needed = 'viewer') => check(req, await lookup(req.user.id, id), needed, what);

  return {
    workspace: async (req, workspaceId, needed = 'viewer') =>
      check(req, { role: await repo.workspaceRole(req.user.id, workspaceId), workspaceId }, needed, 'workspace'),
    board: checker(repo.boardAccess, 'board'),
    column: checker(repo.columnAccess, 'column'),
    label: checker(repo.labelAccess, 'label'),
    task: checker(repo.taskAccess, 'task'),
    checklistItem: checker(repo.checklistAccess, 'checklist item'),
    comment: checker(repo.commentAccess, 'comment'),
    attachment: checker(repo.attachmentAccess, 'attachment'),
    timeEntry: checker(repo.timeEntryAccess, 'time entry'),
  };
}
