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
