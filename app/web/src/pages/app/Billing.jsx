// The admin panel's plan section once billing is on: plans with prices, checkout (Paddle's
// overlay), the subscription with its seats, changing seats or plan with a price preview,
// and the provider's portal for invoices, card details and cancelling. The plan itself
// only changes when the provider's webhook confirms it, so after checkout this waits.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/Toaster.jsx';
import { Dialog, Field } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { openCheckout } from '../../lib/paddle.js';
import { keys } from '../../lib/queries.js';

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const limitSize = (bytes) => (bytes >= GB ? `${Math.round(bytes / GB)} GB` : `${Math.round(bytes / MB)} MB`);
const WAIT_MS = 60_000;

// Amounts arrive in the currency's smallest unit (cents).
export const money = (amount, currency) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: amount % 100 ? 2 : 0 }).format(amount / 100);
const longDate = (iso) => formatDate(iso.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' });
const per = (interval) => (interval === 'year' ? 'year' : 'month');

function statusBadge(sub) {
  if (sub.scheduledChange === 'cancel') return <span className="badge badge-warning">Cancels {longDate(sub.scheduledChangeAt)}</span>;
  if (sub.status === 'trialing') return <span className="badge badge-accent">Free trial until {longDate(sub.trialEndsAt)}</span>;
  if (sub.status === 'past_due') return <span className="badge badge-danger">Payment failed</span>;
  return <span className="badge badge-success">Active</span>;
}

export default function Billing({ workspaceId, billing, waiting, onWaitingChange }) {
  const [interval, setPeriod] = useState(billing.subscription?.interval ?? 'month');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const toast = useToast();
  const sub = billing.subscription;
  const plans = billing.plans;

  const refresh = () =>
    Promise.all(
      [keys.billing(workspaceId), keys.admin(workspaceId), keys.auditLog(workspaceId), keys.workspaces].map((queryKey) =>
        client.invalidateQueries({ queryKey }),
      ),
    );

  // After checkout: the webhook usually lands within seconds.
  useEffect(() => {
    if (!waiting) return;
    if (sub) {
      onWaitingChange(false);
      refresh();
      toast(`Subscribed: this workspace is on ${planName(plans, sub.plan)}`, 'success');
      return;
    }
    const timer = setTimeout(() => {
      onWaitingChange(false);
      toast('Payment received. The plan will switch as soon as Paddle confirms it; refresh in a minute.', 'info');
    }, WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting, sub]);

  async function checkout(choice) {
    const { transactionId, email } = await api.startCheckout(workspaceId, choice);
    await openCheckout(billing.checkout, { transactionId, email }, { completed: () => onWaitingChange(true) });
  }

  async function openPortal(link = 'overview') {
    setBusy(true);
    // Opened before the request, so the browser doesn't block it as a pop-up.
    const tab = window.open('', '_blank');
    try {
      const links = await api.billingPortal(workspaceId);
      const url = links[link] ?? links.overview;
      if (tab) tab.location = url;
      else window.location.href = url;
    } catch (err) {
      tab?.close();
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {billing.checkout?.environment === 'sandbox' && (
        <p className="alert billing-test-note">
          <Icon name="info" size={16} />
          <span>
            <b>Test mode.</b> Payments go through Paddle&apos;s sandbox and no real money moves. Pay with card <code>4242 4242 4242 4242</code>, any
            future expiry date and security code <code>100</code>.
          </span>
        </p>
      )}

      {waiting && (
        <p className="alert billing-waiting">
          <span className="spinner" /> Payment received. Waiting for Paddle to confirm the subscription…
        </p>
      )}

      {sub ? (
        <div className="card billing-current">
          <div className="billing-current-head">
            <div>
              <p className="usage-label">Current subscription</p>
              <h3>
                {planName(plans, sub.plan)} · {sub.seats} seat{sub.seats === 1 ? '' : 's'} · billed {sub.interval === 'year' ? 'yearly' : 'monthly'}
              </h3>
            </div>
            {statusBadge(sub)}
          </div>
          <p className="muted small">
            {sub.status === 'past_due'
              ? 'The last payment didn’t go through. Paddle will retry it; update the card to keep the plan.'
              : sub.scheduledChange === 'cancel'
                ? `The plan stays until ${longDate(sub.scheduledChangeAt)}, then the workspace moves to Free. Nothing is deleted.`
                : sub.nextBilledAt
                  ? `${sub.status === 'trialing' ? 'First payment' : 'Next payment'} on ${longDate(sub.nextBilledAt)}. ${billing.seatsInUse} of ${sub.seats} seats in use.`
                  : `${billing.seatsInUse} of ${sub.seats} seats in use.`}
          </p>
          <div className="billing-actions">
            {sub.status !== 'past_due' && sub.scheduledChange !== 'cancel' && (
              <button className="btn btn-primary btn-sm" onClick={() => setDialog({ type: 'change' })}>
                <Icon name="users" size={15} /> Change seats or plan
              </button>
            )}
            {sub.status === 'past_due' && (
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => openPortal('updatePaymentMethod')}>
                Update card
              </button>
            )}
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => openPortal()}>
              <Icon name="external" size={15} /> Invoices and payment method
            </button>
            {sub.scheduledChange !== 'cancel' && (
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => openPortal('cancel')}>
                Cancel subscription
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="billing-toolbar">
            <div className="segmented" role="group" aria-label="Billing period">
              <button className={interval === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>Monthly</button>
              <button className={interval === 'year' ? 'active' : ''} onClick={() => setPeriod('year')}>Yearly</button>
            </div>
            <span className="faint small">Yearly is two months free. Prices are per seat in USD; checkout shows your local price and tax.</span>
          </div>
          {billing.plan !== 'free' && (
            <p className="muted small section-hint">
              This workspace was moved to {planName(plans, billing.plan)} before payments were switched on, so it has no subscription yet.
            </p>
          )}
          <div className="plan-grid">
            {plans.map((plan) => {
              const price = plan.prices?.[interval];
              const current = plan.key === billing.plan;
              return (
                <article key={plan.key} className={`card plan-card ${current ? 'is-current' : ''}`}>
                  <header>
                    <h3>{plan.name}</h3>
                    {current && <span className="badge badge-accent">Current plan</span>}
                  </header>
                  <p className="plan-price">
                    {plan.key === 'free' ? (
                      <b>Free</b>
                    ) : price ? (
                      <>
                        <b>{money(price.amount, price.currency)}</b> <span className="muted small">per seat / {per(interval)}</span>
                      </>
                    ) : (
                      <span className="muted small">Not on sale</span>
                    )}
                  </p>
                  <PlanFeatures plan={plan} />
                  {plan.key !== 'free' && price && (
                    <button className="btn btn-primary btn-sm btn-block" disabled={waiting} onClick={() => setDialog({ type: 'checkout', plan, interval })}>
                      {price.trialDays ? `Start ${price.trialDays}-day free trial` : `Get ${plan.name}`}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
          {billing.hasBillingAccount && (
            <button className="btn btn-ghost btn-sm billing-past" disabled={busy} onClick={() => openPortal()}>
              <Icon name="external" size={15} /> Past invoices
            </button>
          )}
        </>
      )}

      {dialog?.type === 'checkout' && (
        <CheckoutDialog
          plan={dialog.plan}
          interval={dialog.interval}
          seatsInUse={billing.seatsInUse}
          onCheckout={checkout}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'change' && (
        <ChangeDialog
          workspaceId={workspaceId}
          subscription={sub}
          plans={plans}
          seatsInUse={billing.seatsInUse}
          onChanged={async () => {
            await refresh();
            toast('Subscription updated', 'success');
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

const planName = (plans, key) => plans.find((p) => p.key === key)?.name ?? key;

export function PlanFeatures({ plan }) {
  return (
    <ul>
      <li><Icon name="users" size={15} /> {plan.members === null ? 'Unlimited members' : `Up to ${plan.members} members`}</li>
      <li><Icon name="board" size={15} /> {plan.boards === null ? 'Unlimited boards' : `${plan.boards} boards`}</li>
      <li><Icon name="clip" size={15} /> {limitSize(plan.storageBytes)} of files</li>
    </ul>
  );
}

function SeatsInput({ value, onChange, min, max }) {
  return (
    <Field label="Seats" hint={`One per member or pending invite. ${min} in use now${max ? `; up to ${max}` : ''}.`}>
      {(props) => (
        <input
          {...props}
          className="input billing-seats"
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value === '' ? '' : Math.floor(Number(e.target.value)))}
        />
      )}
    </Field>
  );
}

const seatsProblem = (seats, min, max) =>
  seats === '' || !Number.isFinite(seats) ? 'Enter a number of seats' : seats < min ? `At least ${min} (the seats in use)` : seats > max ? `At most ${max} on this plan` : '';

function CheckoutDialog({ plan, interval, seatsInUse, onCheckout, onClose }) {
  const price = plan.prices[interval];
  const min = Math.max(1, seatsInUse);
  const [seats, setSeats] = useState(Math.min(min, price.maxSeats));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const problem = seatsProblem(seats, min, price.maxSeats);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onCheckout({ plan: plan.key, interval, seats });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={`${plan.name}, billed ${interval === 'year' ? 'yearly' : 'monthly'}`}
      description={price.trialDays ? `Free for ${price.trialDays} days, then billed each ${per(interval)}. Cancel any time before the trial ends and you won't be charged.` : undefined}
      onClose={onClose}
    >
      <form onSubmit={submit} className="billing-form">
        <SeatsInput value={seats} onChange={setSeats} min={min} max={price.maxSeats} />
        {!problem && (
          <p className="billing-total">
            <b>{money(price.amount * seats, price.currency)}</b> per {per(interval)} <span className="muted small">before tax, in USD</span>
          </p>
        )}
        {(problem || error) && <p className="alert alert-error">{problem || error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || Boolean(problem)}>
            {busy ? 'Opening checkout…' : 'Continue to checkout'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// Seats can change any time; plan and billing period only once a trial has ended (a
// Paddle rule). Each choice is priced by the provider before anything changes.
function ChangeDialog({ workspaceId, subscription, plans, seatsInUse, onChanged, onClose }) {
  const trialing = subscription.status === 'trialing';
  const [plan, setPlan] = useState(subscription.plan);
  const [interval, setPeriod] = useState(subscription.interval);
  const [seats, setSeats] = useState(subscription.seats);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const price = plans.find((p) => p.key === plan)?.prices?.[interval];
  const problem = price ? seatsProblem(seats, Math.max(1, seatsInUse), price.maxSeats) : 'This plan isn’t on sale';
  const unchanged = plan === subscription.plan && interval === subscription.interval && seats === subscription.seats;

  // Ask the provider what this would cost, half a second after the last change.
  useEffect(() => {
    setPreview(null);
    setError('');
    if (problem || unchanged) return;
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const result = await api.previewSubscriptionChange(workspaceId, { plan, interval, seats });
        if (!stale) setPreview(result);
      } catch (err) {
        if (!stale) setError(err.message);
      }
    }, 500);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [plan, interval, seats]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.changeSubscription(workspaceId, { plan, interval, seats });
      onClose();
      await onChanged();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Dialog title="Change subscription" onClose={onClose}>
      <form onSubmit={submit} className="billing-form">
        <div className="billing-choice">
          <Field label="Plan">
            {(props) => (
              <select {...props} className="input" value={plan} disabled={trialing} onChange={(e) => setPlan(e.target.value)}>
                {plans.filter((p) => p.key !== 'free').map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="Billed">
            {(props) => (
              <select {...props} className="input" value={interval} disabled={trialing} onChange={(e) => setPeriod(e.target.value)}>
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
              </select>
            )}
          </Field>
        </div>
        {trialing && <p className="faint small">During the free trial only the number of seats can change.</p>}
        <SeatsInput value={seats} onChange={setSeats} min={Math.max(1, seatsInUse)} max={price?.maxSeats} />
        {!problem && !unchanged && (
          <div className="billing-total">
            {preview ? (
              <>
                {preview.dueNow > 0 && <p><b>{money(preview.dueNow, preview.currency)}</b> charged now for the rest of this period</p>}
                {preview.recurring !== null && (
                  <p>
                    Then <b>{money(preview.recurring, preview.currency)}</b> per {per(interval)}
                    {preview.nextBilledAt && ` from ${longDate(preview.nextBilledAt)}`}
                    <span className="muted small"> including tax</span>
                  </p>
                )}
              </>
            ) : (
              !error && <p className="muted small"><span className="spinner" /> Working out the price…</p>
            )}
          </div>
        )}
        {(problem || error) && !unchanged && <p className="alert alert-error">{problem || error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || unchanged || Boolean(problem) || !preview}>
            {busy ? 'Updating…' : 'Confirm change'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
