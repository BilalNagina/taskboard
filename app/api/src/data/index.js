import { activityRepo } from './activity.js';
import { adminRepo } from './admin.js';
import { boardsRepo } from './boards.js';
import { insightsRepo } from './insights.js';
import { membersRepo } from './members.js';
import { notificationsRepo } from './notifications.js';
import { remindersRepo } from './reminders.js';
import { tasksRepo } from './tasks.js';
import { timeRepo } from './time.js';
import { usersRepo } from './users.js';
import { workspacesRepo } from './workspaces.js';

export { LABEL_COLORS } from './boards.js';
export { toPrefixQuery } from './insights.js';
export { EMAIL_PREFS, emailTypesFor, NOTIFICATION_TYPES } from './notifications.js';
export { ROLES, roleAtLeast } from './workspaces.js';

export function createRepo(db) {
  return {
    ...usersRepo(db),
    ...workspacesRepo(db),
    ...membersRepo(db),
    ...boardsRepo(db),
    ...tasksRepo(db),
    ...activityRepo(db),
    ...insightsRepo(db),
    ...notificationsRepo(db),
    ...remindersRepo(db),
    ...timeRepo(db),
    ...adminRepo(db),
  };
}
