// End-to-end tests for paid plans, with a stand-in for the payment provider: checkout,
// webhooks moving the workspace's plan, seat caps, changes and the billing portal.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { setupApi, skipIntegration } from './helpers.js';

const PRICES = {
  pro: { month: 'pri_pro_month', year: 'pri_pro_year' },
  team: { month: 'pri_team_month', year: 'pri_team_year' },
};

function fakeBilling() {
  const calls = [];
  // 'yes', 'no', or 'down' (the provider's IP list can't be loaded).
  const source = { state: 'yes' };
  const price = (plan, interval, amount, maxSeats) => ({ priceId: PRICES[plan][interval], amount, currency: 'USD', maxSeats, trialDays: 7 });
  return {
    calls,
    source,
    isWebhookSource: async () => {
      if (source.state === 'down') throw new Error('IP list unavailable');
      return source.state === 'yes';
    },
    provider: 'fake',
    clientConfig: () => ({ provider: 'fake', environment: 'sandbox', clientToken: 'test_token' }),
    catalog: async () => ({
      pro: { month: price('pro', 'month', 600, 25), year: price('pro', 'year', 6000, 25) },
      team: { month: price('team', 'month', 1200, 1000), year: price('team', 'year', 12000, 1000) },
    }),
    startCheckout: async (args) => {
      calls.push({ checkout: args });
      return { transactionId: 'txn_test' };
    },
    portalLinks: async (args) => {
      calls.push({ portal: args });
      return { overview: 'https://portal.example.com/overview', updatePaymentMethod: null, cancel: null };
    },
    previewChange: async (subscription, change) => ({ currency: 'USD', dueNow: 600, recurring: change.seats * 600, nextBilledAt: '2026-11-14T10:00:00.000Z' }),
    applyChange: async (subscription, change) => ({
      ...subscription,
      ...change,
      priceId: PRICES[change.plan][change.interval],
      occurredAt: new Date().toISOString(),
    }),
    // The real provider checks an HMAC; here only the word "valid" passes.
    parseWebhook: async (rawBody, signature) => {
      if (signature !== 'valid') throw new Error('signature mismatch');
      return JSON.parse(rawBody);
    },
  };
}

describe('paid plans', { skip: skipIntegration }, () => {
  let app, signUp, addMember, close, billing;

  before(async () => {
    billing = fakeBilling();
    ({ app, signUp, addMember, close } = await setupApi({ billing }));
  });

  after(() => close());

  const deliver = (event, signature = 'valid') =>
    request(app).post('/api/billing/webhook').set('Paddle-Signature', signature).set('Content-Type', 'application/json').send(JSON.stringify(event));

  const subscriptionEvent = (owner, { id = `sub_${randomUUID()}`, status = 'trialing', plan = 'pro', interval = 'month', seats = 2, occurredAt = new Date().toISOString(), scheduledChange = null } = {}) => ({
    id: `evt_${randomUUID()}`,
    type: 'subscription.updated',
    subscription: {
      id,
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      customerId: 'ctm_test',
      status,
      plan,
      interval,
      seats,
      priceId: PRICES[plan][interval],
      currency: 'USD',
      nextBilledAt: '2026-11-14T10:00:00.000Z',
      trialEndsAt: status === 'trialing' ? '2026-10-21T10:00:00.000Z' : null,
      scheduledChange,
      scheduledChangeAt: scheduledChange ? '2026-11-14T10:00:00.000Z' : null,
      occurredAt,
    },
  });

  const planOf = async (owner) => (await owner.agent.get('/api/workspaces')).body.find((w) => w.id === owner.workspace.id).plan;

  test('webhooks are refused from addresses that aren’t the provider’s', async () => {
    const owner = await signUp('Ira');
    const event = subscriptionEvent(owner);
    try {
      billing.source.state = 'no';
      assert.equal((await deliver(event)).status, 403);
      billing.source.state = 'down';
      assert.equal((await deliver(event)).status, 503, 'unknown sources get a retry, not a lost event');
    } finally {
      billing.source.state = 'yes';
    }
    assert.equal(await planOf(owner), 'free');
    assert.equal((await deliver(event)).status, 200);
    assert.equal(await planOf(owner), 'pro');
  });

  test('webhooks are refused without a valid signature', async () => {
    const owner = await signUp('Una');
    const event = subscriptionEvent(owner);
    assert.equal((await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').send(JSON.stringify(event))).status, 400);
    assert.equal((await deliver(event, 'forged')).status, 401);
    assert.equal(await planOf(owner), 'free');
  });

  test('a subscription moves the workspace to its plan, caps seats, and ends with it', async () => {
    const owner = await signUp('Pat');
    const id = `sub_${randomUUID()}`;
    const started = subscriptionEvent(owner, { id, seats: 2, occurredAt: '2026-10-14T10:00:00.000Z' });
    assert.equal((await deliver(started)).status, 200);
    assert.equal((await deliver(started)).status, 200, 'a repeated delivery is harmless');
    assert.equal(await planOf(owner), 'pro');

    const billingUrl = `/api/workspaces/${owner.workspace.id}/billing`;
    const state = (await owner.agent.get(billingUrl)).body;
    assert.equal(state.enabled, true);
    assert.equal(state.seatsInUse, 1);
    assert.deepEqual(
      { status: state.subscription.status, plan: state.subscription.plan, seats: state.subscription.seats },
      { status: 'trialing', plan: 'pro', seats: 2 },
    );
    assert.equal(state.plans.find((p) => p.key === 'pro').prices.month.amount, 600);

    // Two paid seats: the owner plus one invite.
    const invitesUrl = `/api/workspaces/${owner.workspace.id}/invites`;
    assert.equal((await owner.agent.post(invitesUrl).send({ email: `one-${randomUUID()}@example.com`, role: 'member' })).status, 201);
    const third = await owner.agent.post(invitesUrl).send({ email: `two-${randomUUID()}@example.com`, role: 'member' });
    assert.equal(third.status, 403);
    assert.match(third.body.error, /all 2 paid seats are taken, counting pending invites\. A workspace owner can add seats/);

    // The change is in the audit log, credited to whoever checked out.
    const entry = (await owner.agent.get(`/api/workspaces/${owner.workspace.id}/activity`)).body.find((e) => e.type === 'workspace.plan_changed');
    assert.deepEqual(entry.data, { from: 'free', to: 'pro', status: 'trialing' });
    assert.equal(entry.actor.id, owner.user.id);

    // An older event arriving late doesn't undo a newer one.
    assert.equal((await deliver(subscriptionEvent(owner, { id, status: 'canceled', occurredAt: '2026-10-14T09:00:00.000Z' }))).status, 200);
    assert.equal(await planOf(owner), 'pro');

    // A scheduled cancellation keeps the plan until it takes effect.
    await deliver(subscriptionEvent(owner, { id, status: 'active', scheduledChange: 'cancel', occurredAt: '2026-10-15T10:00:00.000Z' }));
    assert.equal(await planOf(owner), 'pro');
    assert.equal((await owner.agent.get(billingUrl)).body.subscription.scheduledChange, 'cancel');

    await deliver(subscriptionEvent(owner, { id, status: 'canceled', occurredAt: '2026-10-16T10:00:00.000Z' }));
    assert.equal(await planOf(owner), 'free');
    const after = (await owner.agent.get(billingUrl)).body;
    assert.equal(after.subscription, null);
    assert.equal(after.hasBillingAccount, true, 'invoices stay reachable in the portal');
  });

  test('checkout is for owners, covers the seats in use, and happens once', async () => {
    const owner = await signUp('Che');
    const member = await signUp('Mel');
    await addMember(owner.workspace.id, member.user.id, 'member');
    const url = `/api/workspaces/${owner.workspace.id}/billing/checkout`;

    assert.equal((await member.agent.post(url).send({ plan: 'pro', interval: 'month', seats: 5 })).status, 403);
    assert.equal((await owner.agent.post(url).send({ plan: 'free', interval: 'month', seats: 5 })).status, 400);
    const tooFew = await owner.agent.post(url).send({ plan: 'pro', interval: 'month', seats: 1 });
    assert.equal(tooFew.status, 409);
    assert.match(tooFew.body.error, /2 seats are in use/);

    const res = await owner.agent.post(url).send({ plan: 'team', interval: 'year', seats: 2 });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, { transactionId: 'txn_test', email: owner.email });
    assert.deepEqual(billing.calls.at(-1).checkout, { workspaceId: owner.workspace.id, userId: owner.user.id, plan: 'team', interval: 'year', seats: 2, customerId: undefined });
    assert.equal(await planOf(owner), 'free', 'nothing changes until the webhook arrives');

    await deliver(subscriptionEvent(owner, { plan: 'team', interval: 'year', seats: 2 }));
    const again = await owner.agent.post(url).send({ plan: 'pro', interval: 'month', seats: 2 });
    assert.equal(again.status, 409);
    assert.match(again.body.error, /already has a subscription/);
  });

  test('seats and plan change on the subscription, with a preview first', async () => {
    const owner = await signUp('Sid');
    await deliver(subscriptionEvent(owner, { status: 'active', seats: 2 }));
    const url = `/api/workspaces/${owner.workspace.id}/billing/change`;

    const preview = await owner.agent.post(url).send({ plan: 'pro', interval: 'month', seats: 4, preview: true });
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.body, { currency: 'USD', dueNow: 600, recurring: 2400, nextBilledAt: '2026-11-14T10:00:00.000Z' });
    assert.equal((await owner.agent.get(`/api/workspaces/${owner.workspace.id}/billing`)).body.subscription.seats, 2);

    const changed = await owner.agent.post(url).send({ plan: 'team', interval: 'month', seats: 4 });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.subscription.seats, 4);
    assert.equal(changed.body.plan, 'team');
    const types = (await owner.agent.get(`/api/workspaces/${owner.workspace.id}/activity`)).body.slice(0, 2).map((e) => e.type);
    assert.deepEqual(types, ['workspace.seats_changed', 'workspace.plan_changed']);

    await owner.agent.post(`/api/workspaces/${owner.workspace.id}/invites`).send({ email: `x-${randomUUID()}@example.com`, role: 'member' });
    const below = await owner.agent.post(url).send({ plan: 'team', interval: 'month', seats: 1 });
    assert.equal(below.status, 409);
    assert.match(below.body.error, /2 seats are in use/);

    const none = await signUp('Nia');
    assert.equal((await none.agent.post(`/api/workspaces/${none.workspace.id}/billing/change`).send({ plan: 'pro', interval: 'month', seats: 2 })).status, 409);
  });

  test('the billing portal opens for the workspace’s billing account', async () => {
    const owner = await signUp('Pol');
    const url = `/api/workspaces/${owner.workspace.id}/billing/portal`;
    assert.equal((await owner.agent.post(url)).status, 409);
    const event = subscriptionEvent(owner, { status: 'active' });
    await deliver(event);
    const res = await owner.agent.post(url);
    assert.equal(res.status, 200);
    assert.equal(res.body.overview, 'https://portal.example.com/overview');
    assert.deepEqual(billing.calls.at(-1).portal, { customerId: 'ctm_test', subscriptionId: event.subscription.id });
  });

  test('with billing on, plans aren’t switched for free and a paying workspace isn’t deleted', async () => {
    const owner = await signUp('Dee');
    const switched = await owner.agent.patch(`/api/workspaces/${owner.workspace.id}/plan`).send({ plan: 'team' });
    assert.equal(switched.status, 409);
    assert.match(switched.body.error, /through checkout/);

    await owner.agent.post('/api/workspaces').send({ name: 'Second' });
    const event = subscriptionEvent(owner, { status: 'active', occurredAt: '2026-10-14T10:00:00.000Z' });
    await deliver(event);
    const blocked = await owner.agent.delete(`/api/workspaces/${owner.workspace.id}`);
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /cancel this workspace’s subscription/);

    await deliver({ ...event, subscription: { ...event.subscription, status: 'canceled', occurredAt: '2026-10-15T10:00:00.000Z' } });
    assert.equal((await owner.agent.delete(`/api/workspaces/${owner.workspace.id}`)).status, 204);
    // The subscription outlives its workspace (for the records); later events are still accepted.
    assert.equal((await deliver({ ...event, subscription: { ...event.subscription, status: 'canceled', occurredAt: '2026-10-16T10:00:00.000Z' } })).status, 200);
  });
});
