import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import { HttpError } from '../errors.js';
import { parseContentType, parseFilename, parseId } from '../validation.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Mounted before the JSON parser: the upload body is the raw file, so a JSON file isn't
// parsed (and rejected) as a JSON request.
export function attachmentRoutes({ repo, access, session, storage, limiter, removeFiles }) {
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
      await access.task(req, taskId, 'member');
      if (!(await limiter.hit(`upload:${req.user.id}`, { limit: 30, windowSeconds: 3600 }))) {
        throw new HttpError(429, 'upload limit reached, try again later');
      }

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
      res.status(201).json(attachment);
    },
  );

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
