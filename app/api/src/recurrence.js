// Due dates for repeating tasks. Dates are 'YYYY-MM-DD' strings, computed in UTC so
// daylight-saving changes never shift a day.

export const REPEATS = ['daily', 'weekdays', 'weekly', 'monthly'];

const parse = (iso) => new Date(`${iso}T00:00:00Z`);
const format = (date) => date.toISOString().slice(0, 10);

function step(repeat, iso) {
  const d = parse(iso);
  if (repeat === 'daily') d.setUTCDate(d.getUTCDate() + 1);
  else if (repeat === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (repeat === 'weekdays') {
    do d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  } else if (repeat === 'monthly') {
    // The 31st becomes the last day of a shorter month rather than spilling into the next.
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
  } else {
    throw new Error(`unknown repeat ${repeat}`);
  }
  return format(d);
}

// The next occurrence after `dueDate` (or after today, for a task with no due date) that
// is later than today, so finishing an overdue task doesn't create another overdue one.
export function nextDueDate(repeat, dueDate, today) {
  let next = step(repeat, dueDate ?? today);
  for (let i = 0; next <= today && i < 1000; i++) next = step(repeat, next);
  return next;
}
