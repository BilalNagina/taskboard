import { boardsRepo } from './boards.js';
import { remindersRepo } from './reminders.js';
import { usersRepo } from './users.js';
import { workspacesRepo } from './workspaces.js';

export { ROLES, roleAtLeast } from './workspaces.js';

export function createRepo(db) {
  return {
    ...usersRepo(db),
    ...workspacesRepo(db),
    ...boardsRepo(db),
    ...remindersRepo(db),
  };
}
