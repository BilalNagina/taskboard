-- Paid plans: a copy of each subscription from the payment provider (Paddle), kept up to
-- date by its webhooks. A workspace's plan follows its live subscription; workspaces that
-- never subscribed keep whatever plan they already had.
CREATE TABLE subscriptions (
  id text PRIMARY KEY,                -- the provider's id, e.g. sub_01h...
  workspace_id integer REFERENCES workspaces (id) ON DELETE SET NULL,
  customer_id text NOT NULL,          -- the provider's customer, for the billing portal
  status text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'paused', 'canceled')),
  plan text NOT NULL CHECK (plan IN ('pro', 'team')),
  billing_interval text NOT NULL CHECK (billing_interval IN ('month', 'year')),
  seats integer NOT NULL CHECK (seats > 0),
  price_id text NOT NULL,
  currency text,
  next_billed_at timestamptz,
  trial_ends_at timestamptz,
  scheduled_change text CHECK (scheduled_change IN ('cancel', 'pause', 'resume')),
  scheduled_change_at timestamptz,
  -- When the provider says the last applied change happened. Webhooks can arrive out of
  -- order, so an older event never overwrites a newer one.
  event_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_workspace_id_idx ON subscriptions (workspace_id);
