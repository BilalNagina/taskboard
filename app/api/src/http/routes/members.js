import express from 'express';
import { inviteLink, INVITE_TTL_DAYS } from '../../jobs.js';
import { hashToken, newToken } from '../../sessions.js';
import { HttpError } from '../errors.js';
import { parseId, schemas, validate } from '../validation.js';

// Workspace members and invitations. Owners manage both; anyone can see who's in a
// workspace they belong to. Invites are accepted by the invited email address only.
export function memberRoutes({ repo, access, session, limiter, jobs, appUrl, log }) {
  const router = express.Router();
  const auth = session.requireAuth;

  async function notLastOwner(workspaceId, userId) {
    const member = await repo.getMember(workspaceId, userId);
    if (!member) throw new HttpError(404, 'member not found');
    if (member.role === 'owner' && (await repo.ownerCount(workspaceId)) === 1) {
      throw new HttpError(409, 'a workspace needs at least one owner; make someone else an owner first');
    }
    return member;
  }

  async function sendInvite(invite, token) {
    await jobs.add('invite', { inviteId: invite.id, token }, { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true });
    return inviteLink(appUrl, token);
  }

  // ------------------------------------------------------------ members

  router.get('/workspaces/:id/members', auth, async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    await access.workspace(req, id);
    res.json(await repo.listMembers(id));
  });

  router.patch('/workspaces/:id/members/:userId', auth, async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    const userId = parseId(req.params.userId, 'user');
    const { role } = validate(schemas.memberRole, req.body);
    const a = await access.workspace(req, id, 'owner');
    const member = role === 'owner' ? await repo.getMember(id, userId) : await notLastOwner(id, userId);
    if (!member) throw new HttpError(404, 'member not found');
    await repo.setMemberRole(id, userId, role);
    if (member.role !== role) await log(req, a, 'member.role_changed', { name: member.name, role });
    res.json(await repo.getMember(id, userId));
  });

  // Owners can remove anyone; everyone can remove themselves (leave).
  router.delete('/workspaces/:id/members/:userId', auth, async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    const userId = parseId(req.params.userId, 'user');
    const a = await access.workspace(req, id, userId === req.user.id ? 'viewer' : 'owner');
    const member = await notLastOwner(id, userId);
    await repo.removeMember(id, userId);
    await log(req, a, userId === req.user.id ? 'member.left' : 'member.removed', { name: member.name });
    res.status(204).end();
  });

  // ------------------------------------------------------------ invites (owners)

  router.get('/workspaces/:id/invites', auth, async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    await access.workspace(req, id, 'owner');
    res.json(await repo.listInvites(id));
  });

  // The response includes the link, so the owner can share it directly if email is slow
  // or (in the SES sandbox) can't reach the address.
  router.post('/workspaces/:id/invites', auth, async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    const { email, role } = validate(schemas.invite, req.body);
    const a = await access.workspace(req, id, 'owner');
    if (!(await limiter.hit(`invite:${req.user.id}`, { limit: 50, windowSeconds: 3600 }))) {
      throw new HttpError(429, 'too many invitations, try again later');
    }
    const existing = await repo.findUserByEmail(email);
    if (existing && (await repo.getMember(id, existing.id))) throw new HttpError(409, `${email} is already in this workspace`);

    const token = newToken();
    const invite = await repo.createInvite({ workspaceId: id, email, role, tokenHash: hashToken(token), invitedBy: req.user.id, ttlDays: INVITE_TTL_DAYS });
    const link = await sendInvite(invite, token);
    await log(req, a, 'member.invited', { email, role });
    res.status(201).json({ invite, link });
  });

  router.post('/invites/:id/resend', auth, async (req, res) => {
    const id = parseId(req.params.id, 'invite');
    const invite = await repo.getInvite(id);
    if (!invite) throw new HttpError(404, 'invite not found');
    await access.workspace(req, invite.workspaceId, 'owner');
    const token = newToken();
    await repo.renewInvite(id, hashToken(token), INVITE_TTL_DAYS);
    res.json({ invite: await repo.getInvite(id), link: await sendInvite(invite, token) });
  });

  router.delete('/invites/:id', auth, async (req, res) => {
    const id = parseId(req.params.id, 'invite');
    const invite = await repo.getInvite(id);
    if (!invite) throw new HttpError(404, 'invite not found');
    await access.workspace(req, invite.workspaceId, 'owner');
    await repo.revokeInvite(id);
    res.status(204).end();
  });

  // ------------------------------------------------------------ accepting (invitees)

  // Public, so the invite page can say who invited you before you sign in.
  router.post('/invites/lookup', async (req, res) => {
    const { token } = validate(schemas.inviteToken, req.body);
    if (!(await limiter.hit(`invite-lookup:${req.ip}`, { limit: 60, windowSeconds: 3600 }))) {
      throw new HttpError(429, 'too many requests, try again later');
    }
    const invite = await repo.findInviteByToken(hashToken(token));
    if (!invite) throw new HttpError(404, 'this invite link is invalid or has been replaced');
    const { id, workspaceId, ...shown } = invite;
    res.json(shown);
  });

  // Accepting checks the invite was sent to the signed-in user's own email address.
  async function accept(req, res, invite) {
    if (!invite) throw new HttpError(404, 'this invite link is invalid or has been replaced');
    if (invite.accepted) throw new HttpError(409, 'this invite has already been used');
    if (invite.expired) throw new HttpError(410, 'this invite has expired; ask for a new one');
    if (invite.email !== req.user.email) {
      throw new HttpError(403, `this invite is for ${invite.email}; sign in with that email to accept it`);
    }
    const result = await repo.acceptInvite(invite.id, req.user.id);
    if (!result) throw new HttpError(410, 'this invite has expired; ask for a new one');
    if (!result.alreadyMember) {
      await log(req, { workspaceId: result.workspaceId }, 'member.joined', { name: req.user.name, role: result.role });
    }
    res.json({ workspaceId: result.workspaceId, alreadyMember: result.alreadyMember });
  }

  router.post('/invites/accept', auth, async (req, res) => {
    const { token } = validate(schemas.inviteToken, req.body);
    await accept(req, res, await repo.findInviteByToken(hashToken(token)));
  });

  // ------------------------------------------------------------ my pending invites
  // Invites addressed to the signed-in user's email can be accepted from inside the app,
  // without the link (which may not have arrived, or may have been replaced by a resend).

  router.get('/me/invites', auth, async (req, res) => {
    const invites = await repo.invitesForEmail(req.user.email);
    res.json(invites.map(({ email, ...invite }) => invite));
  });

  router.post('/me/invites/:id/accept', auth, async (req, res) => {
    const id = parseId(req.params.id, 'invite');
    const invite = await repo.getInvite(id);
    // Someone else's invite answers 404, like any other thing you can't see.
    await accept(req, res, invite && invite.email === req.user.email ? { ...invite, accepted: false } : null);
  });

  router.delete('/me/invites/:id', auth, async (req, res) => {
    const id = parseId(req.params.id, 'invite');
    const invite = await repo.getInvite(id);
    if (!invite || invite.email !== req.user.email) throw new HttpError(404, 'invite not found');
    await repo.revokeInvite(id);
    res.status(204).end();
  });

  return router;
}
