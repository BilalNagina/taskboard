// The Paddle provider's webhook handling, with no network: payloads are signed here with
// a test secret, the same way Paddle signs them (HMAC-SHA256 over "timestamp:body").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createBilling } from '../src/billing/index.js';
import { createPaddleBilling } from '../src/billing/paddle.js';

const SECRET = 'pdl_ntfset_test_secret';
const paddle = createPaddleBilling({ apiKey: 'pdl_sdbx_apikey_test', webhookSecret: SECRET, clientToken: 'test_token', environment: 'sandbox' });

const sign = (body, secret = SECRET, ts = Math.floor(Date.now() / 1000)) =>
  `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`;

const at = '2026-10-14T10:00:00.000Z';
const trialEnd = '2026-10-21T10:00:00.000Z';
function subscriptionEvent({ type = 'subscription.created', status = 'trialing', quantity = 3, priceCustom = { plan: 'pro', interval: 'month' }, scheduled = null } = {}) {
  const cycle = { interval: 'month', frequency: 1 };
  return JSON.stringify({
    event_id: 'evt_01test',
    event_type: type,
    occurred_at: at,
    notification_id: 'ntf_01test',
    data: {
      id: 'sub_01test',
      status,
      customer_id: 'ctm_01test',
      address_id: 'add_01test',
      business_id: null,
      currency_code: 'GBP',
      created_at: at,
      updated_at: at,
      started_at: at,
      first_billed_at: null,
      next_billed_at: trialEnd,
      paused_at: null,
      canceled_at: null,
      discount: null,
      collection_mode: 'automatic',
      billing_details: null,
      current_billing_period: { starts_at: at, ends_at: trialEnd },
      billing_cycle: cycle,
      scheduled_change: scheduled,
      items: [
        {
          status,
          quantity,
          recurring: true,
          created_at: at,
          updated_at: at,
          previously_billed_at: null,
          next_billed_at: trialEnd,
          trial_dates: { starts_at: at, ends_at: trialEnd },
          price: {
            id: 'pri_01test',
            product_id: 'pro_01test',
            description: 'Pro monthly',
            name: 'Monthly (per seat)',
            type: 'standard',
            billing_cycle: cycle,
            trial_period: { interval: 'day', frequency: 7 },
            tax_mode: 'account_setting',
            unit_price: { amount: '600', currency_code: 'USD' },
            unit_price_overrides: [],
            quantity: { minimum: 1, maximum: 25 },
            status: 'active',
            custom_data: priceCustom,
            import_meta: null,
            created_at: at,
            updated_at: at,
          },
        },
      ],
      custom_data: { workspaceId: '7', userId: '3' },
      import_meta: null,
    },
  });
}

test('billing is off without an API key, and refuses half a configuration', () => {
  assert.equal(createBilling({}), null);
  assert.throws(() => createBilling({ apiKey: 'pdl_sdbx_apikey_test' }), /PADDLE_WEBHOOK_SECRET/);
});

test('a signed subscription webhook becomes the app’s subscription', async () => {
  const body = subscriptionEvent();
  const event = await paddle.parseWebhook(body, sign(body));
  assert.equal(event.id, 'evt_01test');
  assert.equal(event.type, 'subscription.created');
  assert.deepEqual(event.subscription, {
    id: 'sub_01test',
    workspaceId: 7,
    userId: 3,
    customerId: 'ctm_01test',
    status: 'trialing',
    plan: 'pro',
    interval: 'month',
    seats: 3,
    priceId: 'pri_01test',
    currency: 'GBP',
    nextBilledAt: trialEnd,
    trialEndsAt: trialEnd,
    scheduledChange: null,
    scheduledChangeAt: null,
    occurredAt: at,
  });
});

test('a scheduled cancellation is kept, and the plan stays until it happens', async () => {
  const body = subscriptionEvent({ type: 'subscription.updated', status: 'active', scheduled: { action: 'cancel', effective_at: trialEnd, resume_at: null } });
  const { subscription } = await paddle.parseWebhook(body, sign(body));
  assert.equal(subscription.status, 'active');
  assert.equal(subscription.trialEndsAt, null);
  assert.equal(subscription.scheduledChange, 'cancel');
  assert.equal(subscription.scheduledChangeAt, trialEnd);
});

test('webhooks with a wrong, tampered or stale signature are rejected', async () => {
  const body = subscriptionEvent();
  await assert.rejects(() => paddle.parseWebhook(body, sign(body, 'pdl_ntfset_someone_else')));
  await assert.rejects(() => paddle.parseWebhook(body.replace('"quantity":3', '"quantity":30'), sign(body)));
  await assert.rejects(() => paddle.parseWebhook(body, sign(body, SECRET, Math.floor(Date.now() / 1000) - 3600)));
  await assert.rejects(() => paddle.parseWebhook(body, 'not a signature'));
});

test('events that aren’t about subscriptions are acknowledged without a subscription', async () => {
  const body = JSON.stringify({
    event_id: 'evt_02test',
    event_type: 'customer.created',
    occurred_at: at,
    notification_id: 'ntf_02test',
    data: { id: 'ctm_01test', name: null, email: 'ada@example.com', marketing_consent: false, status: 'active', custom_data: null, locale: 'en', created_at: at, updated_at: at, import_meta: null },
  });
  const event = await paddle.parseWebhook(body, sign(body));
  assert.equal(event.type, 'customer.created');
  assert.equal(event.subscription, null);
});
