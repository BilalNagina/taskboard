import { formatBytes, planLimits } from '../plans.js';
import { HttpError } from './errors.js';

// Plan limits, checked before adding a board, a person or a file. Going over answers 403
// with a message that says which limit and where to change the plan. A paid subscription
// also caps people at the seats paid for.
export function createLimits(repo) {
  async function planOf(workspaceId) {
    const [workspace, subscription] = await Promise.all([repo.getWorkspace(workspaceId), repo.liveSubscription(workspaceId)]);
    return { ...planLimits(workspace.plan), seats: subscription?.seats ?? null };
  }
  const fail = (message, fix = 'change the plan') => {
    throw new HttpError(403, `${message}. A workspace owner can ${fix} in Admin`);
  };
  const paidSeats = (n) => `${n} paid seat${n === 1 ? '' : 's'}`;

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
      const taken = await repo.seatsTaken(workspaceId, email);
      if (plan.members !== null && taken >= plan.members) {
        fail(`the ${plan.name} plan includes up to ${plan.members} members, counting pending invites`);
      }
      if (plan.seats !== null && taken >= plan.seats) {
        fail(`all ${paidSeats(plan.seats)} are taken, counting pending invites`, 'add seats');
      }
    },

    // Joining checks members only: the invite already held a seat, unless the plan or
    // the seats changed since.
    async join(workspaceId) {
      const plan = await planOf(workspaceId);
      const members = await repo.memberCount(workspaceId);
      if (plan.members !== null && members >= plan.members) {
        fail(`this workspace is full: the ${plan.name} plan includes up to ${plan.members} members`);
      }
      if (plan.seats !== null && members >= plan.seats) {
        fail(`this workspace is full: all ${paidSeats(plan.seats)} are taken`, 'add seats');
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
