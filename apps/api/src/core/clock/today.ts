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

const timeInDamascus = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Damascus',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * The date and time in Damascus at `now`, as `YYYY-MM-DDTHH:MM`: a day's report is awaited until
 * 08:00 the next day (S08 rule 10).
 */
export function nowInDamascus(now: Date = new Date()): string {
  return `${todayInDamascus(now)}T${timeInDamascus.format(now)}`;
}
