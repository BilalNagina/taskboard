import express from 'express';
import { DUMMY_HASH, hashPassword, RESET_TTL_MINUTES, verifyPassword } from '../../passwords.js';
import { hashToken, newToken } from '../../sessions.js';
import { HttpError } from '../errors.js';
import { readCookie, SESSION_COOKIE } from '../session.js';
import { schemas, validate } from '../validation.js';

export function authRoutes({ repo, sessions, limiter, jobs, session }) {
  const router = express.Router();

  async function limit(key, max, windowSeconds, message) {
    if (!(await limiter.hit(key, { limit: max, windowSeconds }))) throw new HttpError(429, message);
  }

  router.post('/register', async (req, res) => {
    const { name, email, password } = validate(schemas.register, req.body);
    await limit(`register:${req.ip}`, 20, 3600, 'too many sign-ups from this address, try again later');
    const user = await repo.createUserWithWorkspace({ email, name, passwordHash: await hashPassword(password) });
    if (!user) throw new HttpError(409, 'an account with this email already exists');
    await session.startSession(res, user.id);
    res.status(201).json({ user });
  });

  router.post('/login', async (req, res) => {
    const { email, password } = validate(schemas.login, req.body);
    const limitKey = `login:${email}`;
    await limit(limitKey, 10, 900, 'too many attempts, try again in 15 minutes');

    const found = await repo.findUserForLogin(email);
    // Unknown emails are checked against a dummy hash so they take as long as wrong passwords.
    const valid = await verifyPassword(password, found?.passwordHash ?? DUMMY_HASH);
    if (!found || !valid) throw new HttpError(401, 'wrong email or password');

    await limiter.reset(limitKey);
    await session.startSession(res, found.id);
    const { passwordHash, ...user } = found;
    res.json({ user });
  });

  router.post('/logout', async (req, res) => {
    await session.endSession(req, res);
    res.status(204).end();
  });

  router.get('/me', session.requireAuth, (req, res) => res.json({ user: req.user }));

  // Always answers the same way, so the form can't be used to find out who has an account.
  router.post('/forgot-password', async (req, res) => {
    const { email } = validate(schemas.forgotPassword, req.body);
    await limit(`forgot-ip:${req.ip}`, 10, 3600, 'too many requests, try again later');
    const sendAllowed = await limiter.hit(`forgot:${email}`, { limit: 3, windowSeconds: 3600 });
    const user = sendAllowed ? await repo.findUserByEmail(email) : null;
    if (user) {
      const token = newToken();
      await repo.createPasswordReset(user.id, hashToken(token), RESET_TTL_MINUTES);
      await jobs.add(
        'password-reset',
        { userId: user.id, token },
        { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true },
      );
    }
    res.status(202).json({ message: 'If an account exists for that email, a reset link is on its way.' });
  });

  router.post('/reset-password', async (req, res) => {
    const { token, password } = validate(schemas.resetPassword, req.body);
    await limit(`reset-ip:${req.ip}`, 20, 3600, 'too many attempts, try again later');
    const userId = await repo.resetPassword(hashToken(token), await hashPassword(password));
    if (!userId) throw new HttpError(400, 'this reset link is invalid or has expired');
    // Anyone holding an old session (for example whoever knew the old password) is signed out.
    await sessions.destroyAll(userId);
    await session.startSession(res, userId);
    res.json({ user: await repo.findUserById(userId) });
  });

  return router;
}

export function accountRoutes({ repo, sessions, session }) {
  const router = express.Router();
  router.use(session.requireAuth);

  router.patch('/', async (req, res) => {
    const changes = validate(schemas.profile, req.body);
    res.json({ user: await repo.updateProfile(req.user.id, changes) });
  });

  router.post('/password', async (req, res) => {
    const { currentPassword, newPassword } = validate(schemas.changePassword, req.body);
    if (!(await verifyPassword(currentPassword, await repo.getPasswordHash(req.user.id)))) {
      throw new HttpError(400, 'current password is wrong');
    }
    await repo.setPassword(req.user.id, await hashPassword(newPassword));
    // Keep this browser signed in; sign out every other session.
    await sessions.destroyAll(req.user.id, { except: readCookie(req, SESSION_COOKIE) });
    res.status(204).end();
  });

  return router;
}
