import express from 'express';
import { PLAN_KEYS, PLANS, planLimits } from '../../plans.js';
import { HttpError } from '../errors.js';
import { parseId, schemas, validate } from '../validation.js';

// The workspace admin panel: usage against the plan, members at a glance, the audit log,
// and switching plans while billing is off. Owners only.
export function adminRoutes({ repo, access, session, log, billing }) {
  const router = express.Router();
  const auth = session.requireAuth;

  router.get('/workspaces/:id/admin', auth, async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    await access.workspace(req, id, 'owner');
    const [workspace, usage, members] = await Promise.all([repo.getWorkspace(id), repo.usage(id), repo.memberStats(id)]);
    res.json({
      workspace: { ...workspace, limits: planLimits(workspace.plan) },
      usage,
      members,
      plans: PLAN_KEYS.map((key) => ({ key, ...PLANS[key] })),
    });
  });

  router.get('/workspaces/:id/activity', auth, async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    await access.workspace(req, id, 'owner');
    const before = req.query.before ? parseId(req.query.before, 'activity') : null;
    res.json(await repo.workspaceActivity(id, { before }));
  });

  // Free switching, for when billing is off (local development and tests). With billing
  // on, plans change through checkout and the provider's webhooks. Going down a plan keeps
  // everything already there; it only stops new boards, people or files past the limits.
  router.patch('/workspaces/:id/plan', auth, async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    const { plan } = validate(schemas.plan, req.body);
    const a = await access.workspace(req, id, 'owner');
    if (billing) throw new HttpError(409, 'plans change through checkout in the Billing section');
    const before = await repo.getWorkspace(id);
    const workspace = await repo.setPlan(id, plan);
    if (before.plan !== plan) await log(req, a, 'workspace.plan_changed', { from: before.plan, to: plan });
    res.json({ ...workspace, limits: planLimits(plan) });
  });

  return router;
}
