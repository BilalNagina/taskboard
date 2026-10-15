// Paddle Checkout (an overlay hosted by Paddle, so card details never touch this app) and
// Paddle Retain (payment recovery for the owner who pays). Paddle.js is loaded once, on
// first use; checkout events go to whoever opened it.
import { useEffect } from 'react';
import { initializePaddle } from '@paddle/paddle-js';
import { useBilling } from './queries.js';

let loading = null;
let onEvent = null;

function load({ environment, clientToken }, customerId = null) {
  loading ??= initializePaddle({
    environment,
    token: clientToken,
    ...(customerId && { pwCustomer: { id: customerId } }),
    eventCallback: (event) => onEvent?.(event),
  }).then((paddle) => {
    if (!paddle) throw new Error('The checkout couldn’t load. Check your connection and try again.');
    return paddle;
  });
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

const darkMode = () =>
  document.documentElement.dataset.theme === 'dark' ||
  (!document.documentElement.dataset.theme && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

// Opens checkout for a transaction the API created. `handlers.completed` runs once the
// payment goes through; `handlers.closed` when the overlay closes either way.
export async function openCheckout(config, { transactionId, email }, handlers = {}) {
  const paddle = await load(config);
  onEvent = (event) => {
    if (event.name === 'checkout.completed') handlers.completed?.(event.data);
    if (event.name === 'checkout.closed') handlers.closed?.();
  };
  paddle.Checkout.open({
    transactionId,
    ...(email && { customer: { email } }),
    settings: { displayMode: 'overlay', variant: 'one-page', theme: darkMode() ? 'dark' : 'light', allowLogout: !email },
  });
}

// Tells Paddle Retain who's signed in (their Paddle customer id, never an email or app
// id), so it can show payment-recovery prompts when a renewal fails. Live only: Retain
// doesn't run in sandbox. Used for owners of workspaces that have a billing account.
export function useRetain(workspace) {
  const isOwner = workspace?.role === 'owner';
  const { data: billing } = useBilling(workspace?.id, { enabled: isOwner });
  const customerId = billing?.customerId;
  const config = billing?.checkout;
  useEffect(() => {
    if (!isOwner || !customerId || config?.environment !== 'production') return;
    const wasLoaded = Boolean(loading);
    load(config, customerId)
      .then((paddle) => {
        if (wasLoaded) paddle.Update({ pwCustomer: { id: customerId } });
      })
      .catch(() => {
        // Retain is a nicety; the app works without it.
      });
  }, [isOwner, customerId, config?.environment]);
}
