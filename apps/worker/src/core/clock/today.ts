const dayInDamascus = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Damascus',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The date in Damascus at `now`, as `YYYY-MM-DD`, as `apps/api` reads it. */
export function todayInDamascus(now: Date = new Date()): string {
  return dayInDamascus.format(now);
}

/** The day before a `YYYY-MM-DD` date. */
export function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

const timeInDamascus = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Damascus',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * The date and time in Damascus at `now`, as `YYYY-MM-DDTHH:MM`: a day's report is awaited until
 * 08:00 the next day (S08 rule 10), the time the daily email runs.
 */
export function nowInDamascus(now: Date = new Date()): string {
  return `${todayInDamascus(now)}T${timeInDamascus.format(now)}`;
}
