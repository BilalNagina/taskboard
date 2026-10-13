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
  newTask: z.object({ title: text('title', 200), dueDate: dueDate.optional() }),
  updateTask: z
    .object({
      title: text('title', 200).optional(),
      done: z.boolean('done must be true or false').optional(),
      dueDate: dueDate.optional(),
    })
    .refine(atLeastOne, 'nothing to update'),
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
