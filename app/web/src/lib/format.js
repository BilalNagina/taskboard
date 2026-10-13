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

export const REPEATS = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
];
export const repeatLabel = (value) => REPEATS.find((r) => r.value === value)?.label ?? "Doesn't repeat";

// 45 -> "45m", 90 -> "1h 30m", 120 -> "2h".
export function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// A running timer's elapsed time: "4:05" or "1:04:05".
export function formatElapsed(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// Reads "1h 30m", "1.5h", "90m", "1:30" or "90" (minutes). Null if it can't.
export function parseDuration(text) {
  const s = text.trim().toLowerCase().replace(/\s+/g, '');
  let m = s.match(/^(\d+):([0-5]\d)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(?:(\d+(?:[.,]\d+)?)h)?(?:(\d+)m(?:in)?)?$/);
  if (m && (m[1] || m[2])) return Math.round(parseFloat((m[1] ?? '0').replace(',', '.')) * 60) + Number(m[2] ?? 0);
  return /^\d+$/.test(s) ? Number(s) : null;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
// "Ctrl K" or "⌘ K"
export const modKey = isMac ? '⌘' : 'Ctrl';
