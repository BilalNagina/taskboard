// Subscriptions copied from the payment provider's webhooks, and the workspace plan that
// follows from them. Callers check access first.

// Statuses that keep the paid plan. past_due keeps it while the provider retries the
// payment; paused and canceled drop the workspace back to Free.
export const LIVE_STATUSES = ['trialing', 'active', 'past_due'];

const SUBSCRIPTION = `s.id, s.workspace_id AS "workspaceId", s.customer_id AS "customerId", s.status, s.plan,
  s.billing_interval AS interval, s.seats, s.price_id AS "priceId", s.currency, s.next_billed_at AS "nextBilledAt",
  s.trial_ends_at AS "trialEndsAt", s.scheduled_change AS "scheduledChange", s.scheduled_change_at AS "scheduledChangeAt",
  s.created_at AS "createdAt"`;

export function billingRepo(db) {
  const one = async (text, params) => (await db.query(text, params)).rows[0] ?? null;

  return {
    // The subscription that sets the workspace's plan: its newest live one.
    liveSubscription: (workspaceId) =>
      one(
        `SELECT ${SUBSCRIPTION} FROM subscriptions s
          WHERE s.workspace_id = $1 AND s.status = ANY($2) ORDER BY s.created_at DESC LIMIT 1`,
        [workspaceId, LIVE_STATUSES],
      ),

    // The newest subscription in any state: its customer opens the billing portal (old
    // invoices stay there after cancelling) and is reused for the next checkout.
    latestSubscription: (workspaceId) =>
      one(`SELECT ${SUBSCRIPTION} FROM subscriptions s WHERE s.workspace_id = $1 ORDER BY s.created_at DESC LIMIT 1`, [workspaceId]),

    // Saves the provider's view of a subscription and moves the workspace to the plan it
    // pays for. Returns null when the event is older than what's stored (webhooks can
    // arrive out of order and are retried), otherwise the workspace and its plan before
    // and after. A workspace that was deleted meanwhile is left out.
    applySubscription: (sub) =>
      db.tx(async (tx) => {
        const saved = (
          await tx.query(
            `INSERT INTO subscriptions (id, workspace_id, customer_id, status, plan, billing_interval, seats, price_id, currency,
                                        next_billed_at, trial_ends_at, scheduled_change, scheduled_change_at, event_at)
             VALUES ($1, (SELECT id FROM workspaces WHERE id = $2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             ON CONFLICT (id) DO UPDATE SET
               workspace_id = COALESCE(subscriptions.workspace_id, EXCLUDED.workspace_id),
               customer_id = EXCLUDED.customer_id, status = EXCLUDED.status, plan = EXCLUDED.plan,
               billing_interval = EXCLUDED.billing_interval, seats = EXCLUDED.seats, price_id = EXCLUDED.price_id,
               currency = EXCLUDED.currency, next_billed_at = EXCLUDED.next_billed_at, trial_ends_at = EXCLUDED.trial_ends_at,
               scheduled_change = EXCLUDED.scheduled_change, scheduled_change_at = EXCLUDED.scheduled_change_at,
               event_at = EXCLUDED.event_at, updated_at = now()
             WHERE subscriptions.event_at <= EXCLUDED.event_at
             RETURNING workspace_id AS "workspaceId"`,
            [
              sub.id, sub.workspaceId, sub.customerId, sub.status, sub.plan, sub.interval, sub.seats, sub.priceId, sub.currency,
              sub.nextBilledAt, sub.trialEndsAt, sub.scheduledChange, sub.scheduledChangeAt, sub.occurredAt,
            ],
          )
        ).rows[0];
        if (!saved) return null;
        if (!saved.workspaceId) return { workspaceId: null };

        const before = (await tx.query('SELECT plan FROM workspaces WHERE id = $1 FOR UPDATE', [saved.workspaceId])).rows[0];
        const after = (
          await tx.query(
            `UPDATE workspaces w SET plan = COALESCE(
                (SELECT s.plan FROM subscriptions s WHERE s.workspace_id = w.id AND s.status = ANY($2) ORDER BY s.created_at DESC LIMIT 1),
                'free')
              WHERE w.id = $1 RETURNING plan`,
            [saved.workspaceId, LIVE_STATUSES],
          )
        ).rows[0];
        // Credited to whoever started the checkout, if they still have an account.
        if (before.plan !== after.plan) {
          await tx.query(
            `INSERT INTO activity (workspace_id, actor_id, type, data)
             VALUES ($1, (SELECT id FROM users WHERE id = $2), 'workspace.plan_changed', $3)`,
            [saved.workspaceId, sub.userId, { from: before.plan, to: after.plan, status: sub.status }],
          );
        }
        return { workspaceId: saved.workspaceId, from: before.plan, to: after.plan };
      }),
  };
}
