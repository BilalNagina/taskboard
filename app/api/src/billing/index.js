// Paid plans. The app talks to a billing provider through this interface, so Paddle could
// be swapped for another provider by writing one file like billing/paddle.js:
//
//   provider                     'paddle'
//   clientConfig()               what the browser needs to open checkout
//   catalog()                    { pro: { month: { priceId, amount, currency, maxSeats, trialDays }, year }, team }
//   startCheckout(...)           { transactionId } for the browser to open
//   portalLinks(...)             signed-in links to the provider's billing portal
//   previewChange(sub, change)   { currency, dueNow, recurring, nextBilledAt }
//   applyChange(sub, change)     the updated subscription
//   parseWebhook(raw, signature) { id, type, subscription } after verifying the signature
//
// Without provider keys (local development, tests) there's no billing: owners switch
// plans for free, as before.
import { createPaddleBilling } from './paddle.js';

export { BillingError } from './errors.js';

export function createBilling(paddle, logger) {
  if (!paddle.apiKey) return null;
  if (!paddle.webhookSecret || !paddle.clientToken) {
    throw new Error('PADDLE_WEBHOOK_SECRET and PADDLE_CLIENT_TOKEN must be set with PADDLE_API_KEY');
  }
  return createPaddleBilling(paddle, logger);
}
