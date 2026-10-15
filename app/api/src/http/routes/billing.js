import express from 'express';
import { BillingError } from '../../billing/index.js';
import { PLAN_KEYS, PLANS } from '../../plans.js';
import { HttpError } from '../errors.js';
import { parseId, schemas, validate } from '../validation.js';

// Calls the billing provider, turning its refusals into answers the owner can act on.
async function provider(req, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BillingError) throw new HttpError(409, err.message);
    req.log?.error({ err, code: err.code, detail: err.detail }, 'billing provider request failed');
    throw new HttpError(502, 'the payment provider couldn’t do that just now; try again in a minute');
  }
}

// Paid plans for workspace owners: the plans on sale, the current subscription, checkout,
// changing seats or plan, and the provider's billing portal. Without a provider (billing
// off) only the read works, and the admin panel offers free switching instead.
export function billingRoutes({ repo, access, session, log, billing }) {
  const router = express.Router();
  const auth = session.requireAuth;

  const requireBilling = () => {
    if (!billing) throw new HttpError(404, 'billing isn’t enabled');
  };

  const view = (s) =>
    s && {
      status: s.status,
      plan: s.plan,
      interval: s.interval,
      seats: s.seats,
      currency: s.currency,
      nextBilledAt: s.nextBilledAt,
      trialEndsAt: s.trialEndsAt,
      scheduledChange: s.scheduledChange,
      scheduledChangeAt: s.scheduledChangeAt,
    };

  async function state(req, workspaceId) {
    const [workspace, live, latest, seatsInUse] = await Promise.all([
      repo.getWorkspace(workspaceId),
      repo.liveSubscription(workspaceId),
      repo.latestSubscription(workspaceId),
      repo.seatsTaken(workspaceId),
    ]);
    const catalog = billing ? await provider(req, () => billing.catalog()) : {};
    return {
      enabled: Boolean(billing),
      checkout: billing?.clientConfig() ?? null,
      plan: workspace.plan,
      seatsInUse: Number(seatsInUse),
      subscription: view(live),
      hasBillingAccount: Boolean(latest),
      plans: PLAN_KEYS.map((key) => ({ key, ...PLANS[key], prices: catalog[key] ?? null })),
    };
  }

  // Paying for fewer seats than are taken would lock people out, so it isn't offered.
  async function checkSeats(workspaceId, seats) {
    const taken = Number(await repo.seatsTaken(workspaceId));
    if (seats < taken) throw new HttpError(409, `${taken} seats are in use (members and pending invites); choose at least ${taken}`);
  }

  router.get('/workspaces/:id/billing', auth, async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    await access.workspace(req, id, 'owner');
    res.json(await state(req, id));
  });

  // Starts a checkout: the browser opens Paddle Checkout for the returned transaction. The
  // plan only changes once the provider's webhook says the subscription exists.
  router.post('/workspaces/:id/billing/checkout', auth, async (req, res) => {
    requireBilling();
    const id = parseId(req.params.id, 'workspace');
    const { plan, interval, seats } = validate(schemas.subscriptionChoice, req.body);
    await access.workspace(req, id, 'owner');
    if (await repo.liveSubscription(id)) throw new HttpError(409, 'this workspace already has a subscription; change its plan or seats instead');
    await checkSeats(id, seats);
    const previous = await repo.latestSubscription(id);
    const checkout = await provider(req, () =>
      billing.startCheckout({ workspaceId: id, userId: req.user.id, plan, interval, seats, customerId: previous?.customerId }),
    );
    res.status(201).json({ ...checkout, email: previous ? null : req.user.email });
  });

  // Seats or plan on an existing subscription. With `preview` nothing changes; the answer
  // says what would be charged now and on each renewal.
  router.post('/workspaces/:id/billing/change', auth, async (req, res) => {
    requireBilling();
    const id = parseId(req.params.id, 'workspace');
    const { preview, ...change } = validate(schemas.subscriptionChoice, req.body);
    await access.workspace(req, id, 'owner');
    const subscription = await repo.liveSubscription(id);
    if (!subscription) throw new HttpError(409, 'this workspace has no subscription to change');
    await checkSeats(id, change.seats);
    if (preview) return res.json(await provider(req, () => billing.previewChange(subscription, change)));

    const updated = await provider(req, () => billing.applyChange(subscription, change));
    if (!updated) throw new HttpError(502, 'the payment provider returned a subscription this app doesn’t recognise');
    await repo.applySubscription({ ...updated, workspaceId: id, userId: req.user.id });
    if (updated.seats !== subscription.seats) {
      await log(req, { workspaceId: id }, 'workspace.seats_changed', { from: subscription.seats, to: updated.seats });
    }
    req.live = { workspaceId: id };
    res.json(await state(req, id));
  });

  // Signed-in links to the provider's portal: invoices, card details, cancelling.
  router.post('/workspaces/:id/billing/portal', auth, async (req, res) => {
    requireBilling();
    const id = parseId(req.params.id, 'workspace');
    await access.workspace(req, id, 'owner');
    const latest = await repo.latestSubscription(id);
    if (!latest) throw new HttpError(409, 'this workspace hasn’t had a subscription yet');
    const live = await repo.liveSubscription(id);
    res.json(await provider(req, () => billing.portalLinks({ customerId: latest.customerId, subscriptionId: live?.id ?? null })));
  });

  return router;
}

// The provider's webhook. Mounted before the JSON parser: the signature covers the exact
// bytes received. Nothing is acted on until the signature checks out. Any failure answers
// non-2xx so the provider retries; a stale or repeated event is acknowledged and skipped.
export function billingWebhookRoute({ repo, billing, live }) {
  const router = express.Router();

  router.post('/billing/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    if (!billing) return res.status(404).json({ error: 'not found' });
    const signature = req.get('paddle-signature');
    if (!signature || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'missing signature or body' });
    }

    let event;
    try {
      event = await billing.parseWebhook(req.body.toString('utf8'), signature);
    } catch (err) {
      req.log?.warn({ err: err.message }, 'billing webhook rejected');
      return res.status(401).json({ error: 'invalid signature' });
    }

    if (event.subscription) {
      const result = await repo.applySubscription(event.subscription);
      req.log?.info({ eventId: event.id, type: event.type, subscriptionId: event.subscription.id, applied: Boolean(result), plan: result?.to }, 'billing webhook');
      if (result?.workspaceId) await live.publish({ kind: 'change', workspaceId: result.workspaceId });
    }
    res.json({ received: true });
  });

  return router;
}
