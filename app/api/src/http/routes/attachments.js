import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import { HttpError } from '../errors.js';
import { parseContentType, parseFilename, parseId } from '../validation.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

// Checks the file's first bytes, not just the declared type, so only real images are kept.
export function imageType(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// Mounted before the JSON parser: the upload body is the raw file, so a JSON file isn't
// parsed (and rejected) as a JSON request.
export function attachmentRoutes({ repo, access, limits, session, storage, limiter, removeFiles, log }) {
  const router = express.Router();
  // Auth is per route: this router sits on /api ahead of the others, so a router-wide
  // check would also run for sign-in requests.
  const auth = session.requireAuth;

  router.post(
    '/tasks/:id/attachments',
    auth,
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    async (req, res) => {
      const taskId = parseId(req.params.id, 'task');
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'the file is empty');
      const filename = parseFilename(req.get('x-filename'));
      if (!filename) throw new HttpError(400, 'X-Filename header is required (1-200 characters)');
      const a = await access.task(req, taskId, 'member');
      if (!(await limiter.hit(`upload:${req.user.id}`, { limit: 30, windowSeconds: 3600 }))) {
        throw new HttpError(429, 'upload limit reached, try again later');
      }
      await limits.storage(a.workspaceId, req.body.length);

      // Keys never contain the user's filename, so names can't collide or escape the prefix.
      const storageKey = `attachments/${req.user.id}/${randomUUID()}`;
      const contentType = parseContentType(req.get('content-type'));
      await storage.put(storageKey, req.body, contentType);
      const attachment = await repo.addAttachment(taskId, { storageKey, filename, contentType, size: req.body.length });
      if (!attachment) {
        // The task was deleted while the file was uploading.
        await removeFiles(req, [storageKey]);
        throw new HttpError(404, 'task not found');
      }
      await log(req, a, 'attachment.added', { filename }, taskId);
      res.status(201).json(attachment);
    },
  );

  // ------------------------------------------------------------ avatars
  // Stored under the attachments prefix, which is all the app's IAM key can write to.

  router.post('/me/avatar', auth, express.raw({ type: () => true, limit: MAX_AVATAR_BYTES }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'the image is empty');
    const type = imageType(req.body);
    if (!type) throw new HttpError(400, 'the avatar must be a JPEG, PNG or WebP image');
    const key = `attachments/avatars/${req.user.id}/${randomUUID()}`;
    await storage.put(key, req.body, type);
    const old = await repo.setAvatar(req.user.id, key);
    await removeFiles(req, [old]);
    res.json({ user: await repo.findUserById(req.user.id) });
  });

  router.delete('/me/avatar', auth, async (req, res) => {
    const old = await repo.setAvatar(req.user.id, null);
    await removeFiles(req, [old]);
    res.json({ user: await repo.findUserById(req.user.id) });
  });

  router.get('/avatars/:userId', auth, async (req, res) => {
    const userId = parseId(req.params.userId, 'user');
    const key = (await repo.sharesWorkspace(req.user.id, userId)) ? await repo.getAvatarKey(userId) : null;
    if (!key) throw new HttpError(404, 'avatar not found');
    const file = await storage.get(key);
    res.set({
      'Content-Type': file.contentType ?? 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
      // The URL changes whenever the avatar does (?v=), so it can be cached for a day.
      'Cache-Control': 'private, max-age=86400',
    });
    await pipeline(file.body, res);
  });

  router.get('/attachments/:id', auth, async (req, res) => {
    const id = parseId(req.params.id, 'attachment');
    await access.attachment(req, id);
    const attachment = await repo.getAttachment(id);

    let file;
    try {
      file = await storage.get(attachment.storageKey);
    } catch (err) {
      if (err.name === 'NoSuchKey') throw new HttpError(404, 'file is missing from storage');
      throw err;
    }
    res.set({
      'Content-Type': attachment.contentType,
      'Content-Length': String(file.size ?? attachment.size),
      // Always download, never render inline: an uploaded HTML or SVG file must not run
      // as a page on this site.
      'Content-Disposition': contentDisposition(attachment.filename),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    await pipeline(file.body, res);
  });

  router.delete('/attachments/:id', auth, async (req, res) => {
    const id = parseId(req.params.id, 'attachment');
    await access.attachment(req, id, 'member');
    await removeFiles(req, [await repo.deleteAttachment(id)]);
    res.status(204).end();
  });

  return router;
}

// An ASCII fallback plus the RFC 5987 UTF-8 form, so non-English filenames survive.
function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const utf8 = encodeURIComponent(filename).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
