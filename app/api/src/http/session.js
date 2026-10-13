export const SESSION_COOKIE = 'tb_session';

export function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

export function createSessionHelpers({ sessions, repo, cookieSecure }) {
  const cookieOptions = {
    httpOnly: true,
    secure: cookieSecure,
    // Lax keeps the cookie off cross-site POST/PATCH/DELETE requests, which is the
    // CSRF protection for this API.
    sameSite: 'lax',
    path: '/',
  };

  return {
    async startSession(res, userId) {
      const token = await sessions.create(userId);
      res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: sessions.ttlSeconds * 1000 });
    },

    async endSession(req, res) {
      await sessions.destroy(readCookie(req, SESSION_COOKIE));
      res.clearCookie(SESSION_COOKIE, cookieOptions);
    },

    async requireAuth(req, res, next) {
      const userId = await sessions.get(readCookie(req, SESSION_COOKIE));
      const user = userId ? await repo.findUserById(userId) : null;
      if (!user) return res.status(401).json({ error: 'sign in required' });
      req.user = user;
      next();
    },
  };
}
