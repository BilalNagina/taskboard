// Paddle Checkout (an overlay hosted by Paddle, so card details never touch this app).
// Paddle.js is loaded once, on first use; checkout events go to whoever opened it.
import { initializePaddle } from '@paddle/paddle-js';

let loading = null;
let onEvent = null;

function load({ environment, clientToken }) {
  loading ??= initializePaddle({
    environment,
    token: clientToken,
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
