import { displayTimeZone, formatLocale } from '@vertex-mizan/i18n';

const dateTime = new Intl.DateTimeFormat(formatLocale, {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: displayTimeZone,
});

/**
 * A moment as people in Syria read it: Syrian month names, Latin digits, Damascus time. Dates and
 * counts go through this file; amounts never do (the money module formats them, ADR 0010).
 */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

const date = new Intl.DateTimeFormat(formatLocale, {
  dateStyle: 'medium',
  timeZone: displayTimeZone,
});

/** A moment's day, as people in Syria read it (a member's joining date). */
export function formatDate(iso: string): string {
  return date.format(new Date(iso));
}

// Mid-month in UTC: the name is the same in every time zone.
const monthName = new Intl.DateTimeFormat(formatLocale, { month: 'long', timeZone: 'UTC' });

/** The Syrian name of a month, 1–12 (the fiscal year start: كانون الثاني). */
export function formatMonthName(month: number): string {
  return monthName.format(new Date(Date.UTC(2026, month - 1, 15)));
}

const offsetFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: displayTimeZone,
  timeZoneName: 'longOffset',
});

/** Damascus's offset from UTC on a calendar day, as `+03:00`. */
function damascusOffset(day: string): string {
  const name = offsetFormat
    .formatToParts(new Date(`${day}T12:00:00Z`))
    .find((part) => part.type === 'timeZoneName')?.value;
  // `GMT+03:00`, or `GMT` at a zero offset.
  return name && name !== 'GMT' ? name.slice(3) : '+00:00';
}

/**
 * The first and last moment of a calendar day (`YYYY-MM-DD`) in Damascus, as ISO instants with
 * their offset: the bounds of a date filter, both included.
 */
export function damascusDayBounds(day: string): { start: string; end: string } {
  const offset = damascusOffset(day);
  return { start: `${day}T00:00:00.000${offset}`, end: `${day}T23:59:59.999${offset}` };
}

const calendarDay = new Intl.DateTimeFormat(formatLocale, { dateStyle: 'medium', timeZone: 'UTC' });

/** A calendar day (`YYYY-MM-DD`: a rate's effective date, a holiday), as people in Syria read it. */
export function formatDay(day: string): string {
  return calendarDay.format(new Date(`${day}T00:00:00Z`));
}

const shortDay = new Intl.DateTimeFormat(formatLocale, {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  timeZone: 'UTC',
});

/** A calendar day with its weekday, short, for a row of days. */
export function formatShortDay(day: string): string {
  return shortDay.format(new Date(`${day}T00:00:00Z`));
}

const dayInDamascus = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: displayTimeZone,
});

/** Today in Damascus, as `YYYY-MM-DD`: the default date of a rate and of a rate lookup. */
export function damascusToday(now: Date = new Date()): string {
  return dayInDamascus.format(now);
}

/** A calendar day moved by whole days. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The ISO weekday of a calendar day: 1 Monday … 7 Sunday. */
export function isoWeekday(day: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() || 7) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}
