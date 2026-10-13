import { formatBytes, planLimits } from '../plans.js';
import { HttpError } from './errors.js';

// Plan limits, checked before adding a board, a person or a file. Going over answers 403
// with a message that says which limit and where to change the plan.
export function createLimits(repo) {
  async function planOf(workspaceId) {
    const workspace = await repo.getWorkspace(workspaceId);
    return planLimits(workspace.plan);
  }
  const fail = (message) => {
    throw new HttpError(403, `${message}. A workspace owner can change the plan in Admin`);
  };

  return {
    async board(workspaceId) {
      const plan = await planOf(workspaceId);
      if (plan.boards !== null && (await repo.boardCount(workspaceId)) >= plan.boards) {
        fail(`the ${plan.name} plan includes ${plan.boards} boards per workspace`);
      }
    },

    // A new invite needs a free seat; pending invites hold seats too.
    async invite(workspaceId, email) {
      const plan = await planOf(workspaceId);
      if (plan.members !== null && (await repo.seatsTaken(workspaceId, email)) >= plan.members) {
        fail(`the ${plan.name} plan includes up to ${plan.members} members, counting pending invites`);
      }
    },

    // Joining checks members only: the invite already held a seat, unless the plan
    // changed since.
    async join(workspaceId) {
      const plan = await planOf(workspaceId);
      if (plan.members !== null && (await repo.memberCount(workspaceId)) >= plan.members) {
        fail(`this workspace is full: the ${plan.name} plan includes up to ${plan.members} members`);
      }
    },

    async storage(workspaceId, bytes) {
      const plan = await planOf(workspaceId);
      if ((await repo.storageUsed(workspaceId)) + bytes > plan.storageBytes) {
        fail(`this file would take the workspace past the ${plan.name} plan's ${formatBytes(plan.storageBytes)} of files`);
      }
    },
  };
}
