const dayInDamascus = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Damascus',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The date in Damascus at `now`, as `YYYY-MM-DD`: the "current month" of a manual entry's date
 * (S03 rule 6) and the default date of a copy or a reversal (rules 9–10).
 */
export function todayInDamascus(now: Date = new Date()): string {
  return dayInDamascus.format(now);
}
