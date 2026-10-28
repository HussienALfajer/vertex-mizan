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
