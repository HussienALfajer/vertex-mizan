import {
  type Ledger,
  PROFITABILITY_DIMENSIONS,
  type ProfitabilityDimension,
} from '@vertex-mizan/contracts';
import { damascusToday } from '../../lib/format';

/**
 * The search parameters of the report routes (S09 "Screens"): each read leniently, an unreadable
 * one dropped so the report falls back to its default, and every report's last parameters kept
 * per viewer in this browser (`/reports` opens each with them).
 */

const datePattern = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dateParam = (value: unknown): string | undefined =>
  typeof value === 'string' && datePattern.test(value) ? value : undefined;

export const monthParam = (value: unknown): string | undefined =>
  typeof value === 'string' && monthPattern.test(value) ? value : undefined;

export const uuidParam = (value: unknown): string | undefined =>
  typeof value === 'string' && uuidPattern.test(value) ? value : undefined;

export const codeParam = (value: unknown): string | undefined => {
  const text = typeof value === 'number' ? String(value) : value;
  return typeof text === 'string' && /^\d{1,12}$/.test(text) ? text : undefined;
};

export const ledgerParam = (value: unknown): Ledger | undefined =>
  value === 'book' || value === 'parallel' ? value : undefined;

export const flagParam = (value: unknown): boolean | undefined =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : undefined;

export const levelParam = (value: unknown): 1 | 2 | 3 | 4 | undefined => {
  const level = typeof value === 'string' ? Number(value) : value;
  return level === 1 || level === 2 || level === 3 || level === 4 ? level : undefined;
};

export const byParam = (value: unknown): ProfitabilityDimension | undefined =>
  (PROFITABILITY_DIMENSIONS as readonly unknown[]).includes(value)
    ? (value as ProfitabilityDimension)
    : undefined;

/** The first day of the current month in Damascus, the default start of a period report. */
export function monthStart(): string {
  return `${damascusToday().slice(0, 8)}01`;
}

/** A flag as the API reads it, unset when it is the default. */
export function flagText(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

/** The fiscal year of a date (named after the year it starts in), as `packages/ledger` counts it. */
export function fiscalYearOf(date: string, startMonth: number): number {
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= startMonth ? year : year - 1;
}

/**
 * Whose parameters: one person in one company, so another person on this browser, or the same
 * person in a company without a parallel ledger, never opens a report with someone else's.
 */
export interface SearchScope {
  readonly personId: string;
  readonly companyId: string;
}

const storageKey = (scope: SearchScope, report: string) =>
  `vertex-mizan.reports.${scope.personId}.${scope.companyId}.${report}`;

/** Keeps a report's parameters for this viewer in this company ("Screens": `/reports`). */
export function rememberSearch(scope: SearchScope, report: string, search: object): void {
  try {
    window.localStorage.setItem(storageKey(scope, report), JSON.stringify(search));
  } catch {
    // Storage refused (a private window): the report opens with its defaults next time.
  }
}

/** A report's last parameters in this browser, or none. */
export function rememberedSearch(
  scope: SearchScope,
  report: string,
): Record<string, unknown> | undefined {
  try {
    const text = window.localStorage.getItem(storageKey(scope, report));
    const value: unknown = text ? JSON.parse(text) : undefined;
    return value !== null && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Today in Damascus, a route's fallback end date. */
export function damascusTodayParam(): string {
  return damascusToday();
}
