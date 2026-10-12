// Input parsers return the cleaned value, or null when the input is invalid.

export function parseText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length >= 1 && text.length <= max ? text : null;
}

export function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
}

export function parseEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function parsePassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128 ? value : null;
}

// 'YYYY-MM-DD' for a real calendar date (rejects 2026-02-30).
export function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? value : null;
}

// Keeps a readable name for the download, minus path parts and control characters.
export function parseFilename(value) {
  if (typeof value !== 'string') return null;
  let name;
  try {
    name = decodeURIComponent(value);
  } catch {
    return null;
  }
  name = name.split(/[\\/]/).pop().replace(/[\p{Cc}"]/gu, '').trim();
  return name.length >= 1 && name.length <= 200 ? name : null;
}

export function parseContentType(value) {
  const type = typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '';
  return /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream';
}
