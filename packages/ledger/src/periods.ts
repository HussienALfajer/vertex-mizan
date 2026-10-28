/**
 * Periods and fiscal years of entry dates (S03 "Periods", ADR 0012): a period is a calendar month,
 * and entry numbers restart each fiscal year of the entry date. Dates are `YYYY-MM-DD` strings;
 * no clock and no `Date`.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function partsOf(date: string): { year: number; month: number; day: number } {
  const match = DATE.exec(date);
  if (match === null) throw new RangeError(`Expected a date YYYY-MM-DD, got ${date}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) {
    throw new RangeError(`No such date: ${date}`);
  }
  return { year, month, day };
}

function daysIn(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

const pad = (value: number, width: number) => String(value).padStart(width, '0');

/** The period of a date: its calendar month, `YYYY-MM`. */
export function periodOf(date: string): string {
  const { year, month } = partsOf(date);
  return `${pad(year, 4)}-${pad(month, 2)}`;
}

/** The last day of a date's month (`2028-02-10` → `2028-02-29`). */
export function lastDayOfMonth(date: string): string {
  const { year, month } = partsOf(date);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(daysIn(year, month), 2)}`;
}

/**
 * The fiscal year of a date, for a fiscal year that starts on the first day of `startMonth`
 * (`company_settings.fiscal_year_start_month`, 1–12). It is named after the calendar year it starts
 * in: with a July start, 2027-03-10 is in fiscal year 2026, and 2027-07-01 opens fiscal year 2027.
 */
export function fiscalYearOf(date: string, startMonth: number): number {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new RangeError(`A fiscal year starts in month 1 to 12, not ${startMonth}`);
  }
  const { year, month } = partsOf(date);
  return month >= startMonth ? year : year - 1;
}
