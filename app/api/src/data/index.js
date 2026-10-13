import { activityRepo } from './activity.js';
import { boardsRepo } from './boards.js';
import { membersRepo } from './members.js';
import { remindersRepo } from './reminders.js';
import { tasksRepo } from './tasks.js';
import { usersRepo } from './users.js';
import { workspacesRepo } from './workspaces.js';

export { LABEL_COLORS } from './boards.js';
export { ROLES, roleAtLeast } from './workspaces.js';

export function createRepo(db) {
  return {
    ...usersRepo(db),
    ...workspacesRepo(db),
    ...membersRepo(db),
    ...boardsRepo(db),
    ...tasksRepo(db),
    ...activityRepo(db),
    ...remindersRepo(db),
  };
}
