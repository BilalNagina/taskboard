// Theme: 'system' follows the OS; 'light' and 'dark' are explicit. The choice is saved
// on the account and mirrored in localStorage so index.html can apply it before paint.
const STORAGE_KEY = 'tasklane-theme';

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme ?? 'system');
  } catch {
    // Private windows can block storage; the theme still applies for this visit.
  }
}

export function savedTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'system';
  } catch {
    return 'system';
  }
}
