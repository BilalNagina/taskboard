// Paddle as the payment provider (merchant of record: it handles checkout, tax, invoices
// and the customer billing portal). Everything Paddle-specific stays in this file; the
// rest of the app talks to the interface described in billing/index.js.
import { Environment, LogLevel, Paddle } from '@paddle/paddle-node-sdk';
import { BillingError } from './errors.js';

const CATALOG_TTL_MS = 10 * 60_000;

export function createPaddleBilling({ apiKey, webhookSecret, clientToken, environment }, logger) {
  const paddle = new Paddle(apiKey, {
    environment: environment === 'production' ? Environment.production : Environment.sandbox,
    logLevel: LogLevel.error,
  });

  // Prices are found by their custom data ({ plan, interval }), set when the catalog was
  // created, so price ids never need copying into config and sandbox and live just work.
  let cached = null;
  async function catalog() {
    if (cached && cached.at > Date.now() - CATALOG_TTL_MS) return cached.plans;
    const plans = {};
    for await (const price of paddle.prices.list({ status: ['active'], perPage: 50 })) {
      const { plan, interval } = price.customData ?? {};
      if (!plan || !interval || price.billingCycle?.interval !== interval) continue;
      plans[plan] ??= {};
      plans[plan][interval] = {
        priceId: price.id,
        amount: Number(price.unitPrice.amount),
        currency: price.unitPrice.currencyCode,
        maxSeats: price.quantity?.maximum ?? 100,
        trialDays: price.trialPeriod?.interval === 'day' ? price.trialPeriod.frequency : null,
      };
    }
    cached = { at: Date.now(), plans };
    return plans;
  }

  async function priceFor(plan, interval) {
    const price = (await catalog())[plan]?.[interval];
    if (!price) throw new BillingError(`the ${plan} plan isn't on sale ${interval}ly`);
    return price;
  }

  // Paddle's subscription (from a webhook or an API response) in the app's terms. Null
  // for a subscription to something that isn't one of the plans.
  async function toSubscription(sub, occurredAt) {
    const item = sub.items.find((i) => i.recurring) ?? sub.items[0];
    if (!item?.price) return null;
    let { plan, interval } = item.price.customData ?? {};
    if (!plan) {
      const known = Object.entries(await catalog()).flatMap(([key, byInterval]) =>
        Object.entries(byInterval).map(([every, price]) => ({ key, every, priceId: price.priceId })),
      );
      const match = known.find((p) => p.priceId === item.price.id);
      if (!match) return null;
      ({ key: plan, every: interval } = match);
    }
    const custom = sub.customData ?? {};
    return {
      id: sub.id,
      workspaceId: Number(custom.workspaceId) || null,
      userId: Number(custom.userId) || null,
      customerId: sub.customerId,
      status: sub.status,
      plan,
      interval: interval ?? sub.billingCycle?.interval,
      seats: item.quantity,
      priceId: item.price.id,
      currency: sub.currencyCode,
      nextBilledAt: sub.nextBilledAt,
      trialEndsAt: sub.status === 'trialing' ? (item.trialDates?.endsAt ?? sub.nextBilledAt) : null,
      scheduledChange: sub.scheduledChange?.action ?? null,
      scheduledChangeAt: sub.scheduledChange?.effectiveAt ?? null,
      occurredAt,
    };
  }

  // Paddle only allows seat changes during a trial, billed when it ends (do_not_bill);
  // after that, changes are prorated and charged straight away. A failed charge leaves
  // the subscription as it was.
  async function changeRequest(subscription, { plan, interval, seats }) {
    if (subscription.status === 'past_due') throw new BillingError('the last payment failed; update the card in the billing portal first');
    if (subscription.status === 'paused' || subscription.status === 'canceled') throw new BillingError('this subscription isn’t active');
    const price = await priceFor(plan, interval);
    if (seats > price.maxSeats) throw new BillingError(`the ${plan} plan goes up to ${price.maxSeats} seats`);
    const trialing = subscription.status === 'trialing';
    if (trialing && price.priceId !== subscription.priceId) {
      throw new BillingError('during the free trial only the number of seats can change; switch plans after it ends');
    }
    return {
      items: [{ priceId: price.priceId, quantity: seats }],
      prorationBillingMode: trialing ? 'do_not_bill' : 'prorated_immediately',
      onPaymentFailure: 'prevent_change',
    };
  }

  return {
    provider: 'paddle',

    // What the browser needs to open Paddle Checkout. The client token is public.
    clientConfig: () => ({ provider: 'paddle', environment: environment === 'production' ? 'production' : 'sandbox', clientToken }),

    catalog,

    // The transaction is created here, not in the browser, so the workspace it pays for
    // (custom data, copied onto the subscription) can't be changed by the buyer.
    async startCheckout({ workspaceId, userId, plan, interval, seats, customerId = null }) {
      const price = await priceFor(plan, interval);
      if (seats > price.maxSeats) throw new BillingError(`the ${plan} plan goes up to ${price.maxSeats} seats`);
      const transaction = await paddle.transactions.create({
        items: [{ priceId: price.priceId, quantity: seats }],
        customData: { workspaceId: String(workspaceId), userId: String(userId) },
        ...(customerId && { customerId }),
      });
      return { transactionId: transaction.id };
    },

    // Signed-in links to Paddle's billing portal: invoices, payment method, cancelling.
    async portalLinks({ customerId, subscriptionId }) {
      const session = await paddle.customerPortalSessions.create(customerId, subscriptionId ? [subscriptionId] : []);
      const links = session.urls.subscriptions?.[0];
      return {
        overview: session.urls.general.overview,
        updatePaymentMethod: links?.updateSubscriptionPaymentMethod ?? null,
        cancel: links?.cancelSubscription ?? null,
      };
    },

    // What a change would cost: charged now (prorated) and on each renewal after it.
    async previewChange(subscription, change) {
      const preview = await paddle.subscriptions.previewUpdate(subscription.id, await changeRequest(subscription, change));
      const now = preview.immediateTransaction?.details.totals;
      const recurring = preview.recurringTransactionDetails?.totals;
      return {
        currency: preview.currencyCode,
        dueNow: now ? Number(now.grandTotal ?? now.total) : 0,
        recurring: recurring ? Number(recurring.grandTotal ?? recurring.total) : null,
        nextBilledAt: preview.nextBilledAt,
      };
    },

    // Applies a change and returns the updated subscription, so the plan can be updated
    // without waiting for the webhook (which repeats it harmlessly).
    async applyChange(subscription, change) {
      const updated = await paddle.subscriptions.update(subscription.id, await changeRequest(subscription, change));
      return toSubscription(updated, updated.updatedAt);
    },

    // Verifies the Paddle-Signature header against the raw body (throws if it doesn't
    // match or is too old), then returns the event. `subscription` is set for
    // subscription events about one of the plans.
    async parseWebhook(rawBody, signature) {
      const event = await paddle.webhooks.unmarshal(rawBody, webhookSecret, signature);
      const isSubscription = event.eventType.startsWith('subscription.');
      const subscription = isSubscription ? await toSubscription(event.data, event.occurredAt) : null;
      if (isSubscription && !subscription) logger?.warn({ eventId: event.eventId }, 'subscription for an unknown price; ignored');
      return { id: event.eventId, type: event.eventType, subscription };
    },
  };
}
