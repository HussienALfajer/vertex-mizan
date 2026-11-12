import type { Transaction } from '../client.js';
import { periods } from '../schema/ledger.js';

/**
 * The closed months of the company in context as the rules read them (S07 rules 1 and 4): the
 * periods whose state is `closed` (a `reopened` one posts as open), and, while any month is closed,
 * every month before the company's first period, which has no row. `closedBefore` is that first
 * period (null while no month is closed).
 */
export interface ClosedPeriods {
  readonly closed: ReadonlySet<string>;
  readonly closedBefore: string | null;
}

export async function readClosedPeriods(tx: Transaction): Promise<ClosedPeriods> {
  const rows = await tx
    .select({ period: periods.period, state: periods.state })
    .from(periods)
    .orderBy(periods.period);
  const closed = new Set(rows.filter((row) => row.state === 'closed').map((row) => row.period));
  return { closed, closedBefore: closed.size > 0 ? (rows[0]?.period ?? null) : null };
}

/** Whether `period` (`YYYY-MM`) is closed (S07 rules 1, 4). */
export function isClosedPeriod(view: ClosedPeriods, period: string): boolean {
  return view.closed.has(period) || (view.closedBefore !== null && period < view.closedBefore);
}

/** The earliest month the books keep (a fiscal year is 2000 to 9999, `periods_fiscal_year`). */
const EARLIEST_MONTH = '2000-01';

/**
 * Every closed month as a list, for the reads that look months up in one (the first open day after
 * a date, a schedule's closed elapsed months): the closed periods and, while any is closed, each
 * month from 2000-01 to the one before the company's first period.
 */
export async function closedPeriodList(tx: Transaction): Promise<string[]> {
  const view = await readClosedPeriods(tx);
  const before: string[] = [];
  if (view.closedBefore !== null) {
    let [year, month] = EARLIEST_MONTH.split('-').map(Number) as [number, number];
    for (;;) {
      const text = `${year}-${String(month).padStart(2, '0')}`;
      if (text >= view.closedBefore) break;
      before.push(text);
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
  }
  return [...before, ...[...view.closed].sort()];
}
