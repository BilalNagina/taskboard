import { z } from 'zod';
import { HttpError } from './errors.js';

const text = (field, max) =>
  z
    .string(`${field} is required`)
    .trim()
    .min(1, `${field} is required`)
    .max(max, `${field} must be at most ${max} characters`);

const email = z
  .string('email is required')
  .trim()
  .toLowerCase()
  .pipe(z.email('a valid email is required').max(254, 'a valid email is required'));

const newPassword = z
  .string('password is required')
  .min(8, 'password must be 8-128 characters')
  .max(128, 'password must be 8-128 characters');

const dueDate = z.iso.date('dueDate must be a date (YYYY-MM-DD) or null').nullable();

const atLeastOne = (value) => Object.values(value).some((v) => v !== undefined);

const id = (what) => z.number(`${what} must be an id`).int(`${what} must be an id`).positive(`${what} must be an id`);
const ids = (what) => z.array(id(what), `${what}s must be a list of ids`).max(50, `too many ${what}s`);
const priority = z.enum(['none', 'low', 'medium', 'high', 'urgent'], 'priority must be none, low, medium, high or urgent');
const role = z.enum(['owner', 'member', 'viewer'], 'role must be owner, member or viewer');
const color = z.enum(['gray', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'], 'unknown label colour');
const description = z.string('description must be text').max(5000, 'description must be at most 5000 characters');

export const schemas = {
  register: z.object({ name: text('name', 80), email, password: newPassword }),
  login: z.object({
    email,
    password: z.string('password is required').min(1, 'password is required').max(128, 'wrong email or password'),
  }),
  forgotPassword: z.object({ email }),
  resetPassword: z.object({
    token: z.string('token is required').min(20, 'this reset link is invalid').max(200, 'this reset link is invalid'),
    password: newPassword,
  }),
  profile: z
    .object({ name: text('name', 80).optional(), theme: z.enum(['system', 'light', 'dark']).optional() })
    .refine(atLeastOne, 'nothing to update'),
  changePassword: z.object({
    currentPassword: z.string('current password is required').min(1, 'current password is required').max(128),
    newPassword,
  }),
  workspace: z.object({ name: text('workspace name', 80) }),
  board: z.object({ name: text('board name', 80) }),
  newTask: z.object({
    title: text('title', 200),
    columnId: id('columnId').optional(),
    dueDate: dueDate.optional(),
    priority: priority.optional(),
    description: description.optional(),
    assigneeIds: ids('assignee').optional(),
    labelIds: ids('label').optional(),
  }),
  updateTask: z
    .object({
      title: text('title', 200).optional(),
      done: z.boolean('done must be true or false').optional(),
      dueDate: dueDate.optional(),
      priority: priority.optional(),
      description: description.optional(),
      assigneeIds: ids('assignee').optional(),
      labelIds: ids('label').optional(),
    })
    .refine(atLeastOne, 'nothing to update'),
  moveTask: z.object({ columnId: id('columnId'), index: z.number().int().min(0, 'index must be 0 or more') }),
  moveColumn: z.object({ index: z.number().int().min(0, 'index must be 0 or more') }),
  column: z.object({ name: text('column name', 40), isDone: z.boolean().optional() }),
  updateColumn: z
    .object({ name: text('column name', 40).optional(), isDone: z.boolean('isDone must be true or false').optional() })
    .refine(atLeastOne, 'nothing to update'),
  label: z.object({ name: text('label name', 30), color }),
  updateLabel: z.object({ name: text('label name', 30).optional(), color: color.optional() }).refine(atLeastOne, 'nothing to update'),
  checklistItem: z.object({ text: text('checklist item', 300) }),
  updateChecklistItem: z
    .object({ text: text('checklist item', 300).optional(), done: z.boolean('done must be true or false').optional() })
    .refine(atLeastOne, 'nothing to update'),
  comment: z.object({ body: text('comment', 5000), mentions: ids('mention').optional() }),
  invite: z.object({ email, role }),
  memberRole: z.object({ role }),
  inviteToken: z.object({ token: z.string('token is required').min(20, 'this invite link is invalid').max(200, 'this invite link is invalid') }),
};

// Returns the parsed value or throws a 400 with the first problem found.
export function validate(schema, value) {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  throw new HttpError(400, result.error.issues[0].message);
}

export function parseId(value, what) {
  const id = Number(value);
  if (Number.isInteger(id) && id > 0 && id <= 2_147_483_647) return id;
  throw new HttpError(400, `invalid ${what} id`);
}

// Keeps a readable name for the download, minus path parts and control characters.
export function parseFilename(value) {
  if (typeof value !== 'string') return null;
  let name;
  try {
    name = decodeURIComponent(value);
  } catch {
    return null;
  }
  name = name.split(/[\\/]/).pop().replace(/[\p{Cc}"]/gu, '').trim();
  return name.length >= 1 && name.length <= 200 ? name : null;
}

export function parseContentType(value) {
  const type = typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '';
  return /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream';
}
