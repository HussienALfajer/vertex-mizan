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
