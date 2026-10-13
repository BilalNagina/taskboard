export function localToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function daysUntil(isoDate) {
  return Math.round((Date.parse(isoDate) - Date.parse(localToday())) / 86_400_000);
}

export function formatDate(isoDate, options = { day: 'numeric', month: 'short' }) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, options);
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase();
}

// A stable colour per person, so the same user always has the same avatar colour.
const AVATAR_COLOURS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#db2777', '#7c3aed', '#2563eb', '#dc2626'];
export function colourFor(seed = '') {
  let hash = 0;
  for (const ch of String(seed)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
}

// "just now", "5m ago", "3h ago", "Yesterday", "12 Oct".
export function timeAgo(iso) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 172_800) return 'Yesterday';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export const PRIORITIES = [
  { value: 'urgent', label: 'Urgent', tone: 'red' },
  { value: 'high', label: 'High', tone: 'amber' },
  { value: 'medium', label: 'Medium', tone: 'blue' },
  { value: 'low', label: 'Low', tone: 'gray' },
  { value: 'none', label: 'No priority', tone: 'gray' },
];
export const priorityInfo = (value) => PRIORITIES.find((p) => p.value === value) ?? PRIORITIES[4];

export const LABEL_COLORS = ['gray', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'];

// Due-date badge for a card or task: null when there's no date.
export function dueInfo(dueDate, done) {
  if (!dueDate) return null;
  const days = daysUntil(dueDate);
  if (done) return { label: formatDate(dueDate), tone: '' };
  if (days < 0) return { label: days === -1 ? 'Yesterday' : `${formatDate(dueDate)}`, tone: 'badge-danger', overdue: true };
  if (days === 0) return { label: 'Today', tone: 'badge-warning' };
  if (days === 1) return { label: 'Tomorrow', tone: 'badge-warning' };
  return { label: formatDate(dueDate), tone: '' };
}
