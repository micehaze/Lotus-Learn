// Injectable clock so day-boundary rules (one lotus per day) are testable.
let offsetMs = 0;
let fixed = null;
export const clock = {
  now: () => (fixed !== null ? new Date(fixed) : new Date(Date.now() + offsetMs)),
  iso: () => clock.now().toISOString(),
  ms: () => clock.now().getTime(),
  set(date) { fixed = date === null ? null : new Date(date).getTime(); },
  advance(ms) { if (fixed !== null) fixed += ms; else offsetMs += ms; },
  reset() { fixed = null; offsetMs = 0; },
};

/** Calendar date (YYYY-MM-DD) in the given IANA time zone. Falls back to UTC for invalid zones. */
export function localDay(date, timeZone = 'UTC') {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
export function isValidTimeZone(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}
export function addDays(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
