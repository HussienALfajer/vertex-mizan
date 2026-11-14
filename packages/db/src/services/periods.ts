import {
  type ChecklistItem,
  type ChecklistItemName,
  DomainError,
  failingItems,
  type Ledger,
  monthsOf,
  PERIODS_RANGE_LIMIT,
  type PeriodDetail,
  type PeriodEvent,
  type PeriodState,
  type PeriodSummary,
} from '@vertex-mizan/contracts';
import { lastDayOfMonth, periodOf } from '@vertex-mizan/ledger';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type AuditActor, writeCompanyAudit } from '../audit.js';
import type { Transaction } from '../client.js';
import { isClosedPeriod, readClosedPeriods } from '../posting/periods.js';
import { openingIsPosted, writePeriodTransition } from '../posting/post.js';
import { users } from '../schema/access.js';
import { companySettings } from '../schema/companies.js';
import { entryDrafts } from '../schema/drafts.js';
import {
  journalEntries,
  journalLines,
  ledgerHeads,
  periodEvents,
  periods,
} from '../schema/ledger.js';
import { ledgersOf } from './companies.js';
import { missingBulletinDays, revaluationCheck } from './revaluation.js';

// Periods and the close (S07 rules 1–9, ADR 0016): the pre-close checklist computed on read and
// inside the close, the close in order with its checklist stored, the reopen of the latest closed
// month, and the reads of /api/periods. The items of Hub's features left with Hub (ADR 0021).

type Person = Extract<AuditActor, { kind: 'person' }>;

/** The month before `period` (`YYYY-MM`). */
function monthBefore(period: string): string {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

async function companyLedgerNames(tx: Transaction): Promise<Ledger[]> {
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  return ledgersOf(settings).parallel === null ? ['book'] : ['book', 'parallel'];
}

/** The transaction currencies of the lines dated in `period`. */
async function lineCurrencies(tx: Transaction, period: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ currency: journalLines.currency })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      and(
        eq(journalEntries.companyId, journalLines.companyId),
        eq(journalEntries.id, journalLines.entryId),
      ),
    )
    .where(
      sql`${journalEntries.entryDate} between ${`${period}-01`} and ${lastDayOfMonth(`${period}-01`)}`,
    );
  return rows.map((row) => row.currency);
}

/**
 * The control accounts whose balance per dimension set and currency at the end of `period`
 * differs from their items' movements dated on or before it, in any ledger, revaluation movements
 * included (S07 rule 8, `open_items_agree`; S04), summed in SQL.
 */
async function controlAccountsDiffering(tx: Transaction, period: string): Promise<number> {
  const lastDay = lastDayOfMonth(`${period}-01`);
  const result = await tx.execute<{ count: number }>(sql`
    with balances as (
      select b.account_id, b.dimension_set_id, b.currency,
        sum(b.debit_minor - b.credit_minor) as amount,
        sum(b.book_debit_minor - b.book_credit_minor) as book,
        sum(coalesce(b.parallel_debit_minor, 0) - coalesce(b.parallel_credit_minor, 0)) as parallel
      from period_balances b
      join periods p on p.company_id = b.company_id and p.id = b.period_id
      join chart_accounts a on a.company_id = b.company_id and a.id = b.account_id
      where a.item_kind is not null and p.period <= ${period}
      group by b.account_id, b.dimension_set_id, b.currency
    ), movements as (
      select l.account_id, l.dimension_set_id, l.currency,
        sum(m.amount_minor) as amount,
        sum(m.book_minor) as book,
        sum(coalesce(m.parallel_minor, 0)) as parallel
      from open_item_movements m
      join journal_lines l on l.company_id = m.company_id and l.id = m.line_id
      where m.entry_date <= ${lastDay}
      group by l.account_id, l.dimension_set_id, l.currency
    )
    select count(*)::int as count
    from balances full join movements using (account_id, dimension_set_id, currency)
    where coalesce(balances.amount, 0) <> coalesce(movements.amount, 0)
      or coalesce(balances.book, 0) <> coalesce(movements.book, 0)
      or coalesce(balances.parallel, 0) <> coalesce(movements.parallel, 0)
  `);
  return Number(result.rows[0]?.count ?? 0);
}

async function draftsOf(tx: Transaction, period: string): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(entryDrafts)
    .where(
      and(
        inArray(entryDrafts.state, ['draft', 'submitted']),
        isNull(entryDrafts.archivedAt),
        sql`${entryDrafts.entryDate} between ${`${period}-01`} and ${lastDayOfMonth(`${period}-01`)}`,
      ),
    );
  return row?.count ?? 0;
}

function item(
  name: ChecklistItemName,
  failures: readonly { readonly ledger: Ledger | null; readonly count: number }[],
  applicable = true,
): ChecklistItem {
  const failed = failures.filter((failure) => failure.count > 0);
  return {
    item: name,
    result: !applicable ? 'not_applicable' : failed.length > 0 ? 'failed' : 'passed',
    count: failed.reduce((total, failure) => total + failure.count, 0),
    ledgers: failed.flatMap((failure) => (failure.ledger === null ? [] : [failure.ledger])),
  };
}

/**
 * The pre-close checklist of `period` as the books stand now (S07 rule 8), in its order, without
 * the items retired with Hub (`RETIRED_CHECKLIST_ITEMS`, ADR 0021). A company without a parallel
 * ledger has no parallel side; the bulletin item is not applicable without a ledger at the bulletin.
 */
export async function periodChecklist(tx: Transaction, period: string): Promise<ChecklistItem[]> {
  const ledgers = await companyLedgerNames(tx);
  const revaluations = new Map<Ledger, Awaited<ReturnType<typeof revaluationCheck>>>();
  for (const ledger of ledgers)
    revaluations.set(ledger, await revaluationCheck(tx, period, ledger));
  const lines = await lineCurrencies(tx, period);
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  const policies = ledgersOf(settings);
  const atBulletin = ledgers.filter(
    (ledger) =>
      (ledger === 'book' ? policies.book : policies.parallel)?.ratePolicy.rateType === 'bulletin',
  );
  const bulletins = [];
  for (const ledger of atBulletin) {
    const currencies = [
      ...new Set([...lines, ...(revaluations.get(ledger)?.currencies ?? [])]),
    ] as Parameters<typeof missingBulletinDays>[3];
    bulletins.push({
      ledger,
      count: (await missingBulletinDays(tx, period, ledger, currencies)).length,
    });
  }
  return [
    item('bulletins_recorded', bulletins, atBulletin.length > 0),
    item(
      'closing_rates_recorded',
      ledgers.map((ledger) => ({ ledger, count: revaluations.get(ledger)?.missingRates ?? 0 })),
    ),
    item('no_drafts', [{ ledger: null, count: await draftsOf(tx, period) }]),
    item('open_items_agree', [{ ledger: null, count: await controlAccountsDiffering(tx, period) }]),
    item(
      'revaluation_current',
      ledgers.map((ledger) => ({
        ledger,
        count: revaluations.get(ledger)?.state === 'current' ? 0 : 1,
      })),
    ),
  ];
}

/** The ledger head locked first (ADR 0008's lock order), with its company. */
async function lockHead(tx: Transaction): Promise<{ companyId: string }> {
  const [head] = await tx
    .select({ companyId: ledgerHeads.companyId })
    .from(ledgerHeads)
    .for('update');
  if (!head) throw new Error('A company without its ledger head');
  return { companyId: head.companyId };
}

async function lockPeriod(tx: Transaction, period: string) {
  const [row] = await tx.select().from(periods).where(eq(periods.period, period)).for('update');
  return row;
}

async function historyOf(tx: Transaction, periodIds: readonly string[]) {
  if (periodIds.length === 0) return new Map<string, PeriodEvent[]>();
  const rows = await tx
    .select({ event: periodEvents, name: users.name })
    .from(periodEvents)
    .leftJoin(users, eq(users.id, periodEvents.userId))
    .where(inArray(periodEvents.periodId, [...periodIds]))
    .orderBy(asc(periodEvents.createdAt), asc(periodEvents.id));
  const history = new Map<string, PeriodEvent[]>();
  for (const { event, name } of rows) {
    const events = history.get(event.periodId) ?? [];
    events.push({
      id: event.id,
      kind: event.kind as PeriodEvent['kind'],
      reason: event.reason,
      user: { id: event.userId, name: name ?? '' },
      createdAt: event.createdAt.toISOString(),
    });
    history.set(event.periodId, events);
  }
  return history;
}

/**
 * `GET /api/periods/:period` (S07 "API"): the month's state (`open` with no row; `closed` before
 * the first period while a month is closed, rule 4), whether it has ended in Asia/Damascus, the
 * first period, its history oldest first, and its checklist: the one stored at its close for a
 * closed month, computed now otherwise.
 */
export async function readPeriod(
  tx: Transaction,
  period: string,
  today: string,
): Promise<PeriodDetail> {
  const view = await readClosedPeriods(tx);
  const [first] = await tx
    .select({ period: periods.period })
    .from(periods)
    .orderBy(asc(periods.period))
    .limit(1);
  const [row] = await tx.select().from(periods).where(eq(periods.period, period));
  const history = row === undefined ? [] : ((await historyOf(tx, [row.id])).get(row.id) ?? []);
  const state: PeriodState = row?.state
    ? (row.state as PeriodState)
    : isClosedPeriod(view, period)
      ? 'closed'
      : 'open';
  let checklist: ChecklistItem[];
  if (state === 'closed' && row !== undefined) {
    const [stored] = await tx
      .select({ checklist: periodEvents.checklist })
      .from(periodEvents)
      .where(and(eq(periodEvents.periodId, row.id), eq(periodEvents.kind, 'closed')))
      .orderBy(desc(periodEvents.createdAt))
      .limit(1);
    checklist = (stored?.checklist as ChecklistItem[] | null) ?? [];
  } else if (state === 'closed') {
    checklist = [];
  } else {
    checklist = await periodChecklist(tx, period);
  }
  return {
    period,
    state,
    ended: lastDayOfMonth(`${period}-01`) < today,
    firstPeriod: first?.period ?? null,
    history,
    checklist,
  };
}

/**
 * `GET /api/periods?from=&to=` (S07 "API"): each month of the range, at most 24
 * (`VALIDATION_FAILED`), by default the first period (or the 24th month back, when later) to the
 * current month, with its state, whether it has ended, its last event and, for an ended month not
 * closed, how many checklist items fail.
 */
export async function readPeriods(
  tx: Transaction,
  input: {
    readonly from?: string | undefined;
    readonly to?: string | undefined;
    readonly today: string;
  },
): Promise<PeriodSummary[]> {
  const rows = await tx.select().from(periods).orderBy(asc(periods.period));
  const current = periodOf(input.today);
  const to = input.to ?? current;
  let earliest = to;
  for (let back = 1; back < PERIODS_RANGE_LIMIT; back += 1) earliest = monthBefore(earliest);
  const first = rows[0]?.period ?? to;
  const from = input.from ?? (first > to ? to : first < earliest ? earliest : first);
  if (from > to) {
    throw new DomainError('VALIDATION_FAILED', 'from comes before to', { from, to });
  }
  const months = monthsOf({ from, to });
  if (months.length > PERIODS_RANGE_LIMIT) {
    throw new DomainError('VALIDATION_FAILED', `At most ${PERIODS_RANGE_LIMIT} months`, {
      from,
      to,
    });
  }
  const view = await readClosedPeriods(tx);
  const history = await historyOf(
    tx,
    rows.filter((row) => months.includes(row.period)).map((row) => row.id),
  );
  const summaries: PeriodSummary[] = [];
  for (const month of months) {
    const row = rows.find((candidate) => candidate.period === month);
    const state: PeriodState = row
      ? (row.state as PeriodState)
      : isClosedPeriod(view, month)
        ? 'closed'
        : 'open';
    const ended = lastDayOfMonth(`${month}-01`) < input.today;
    summaries.push({
      period: month,
      state,
      ended,
      lastEvent: (row && history.get(row.id)?.at(-1)) ?? null,
      failingItems:
        ended && state !== 'closed' ? failingItems(await periodChecklist(tx, month)).length : null,
    });
  }
  return summaries;
}

/**
 * Closes `period` with a reason (S07 rules 2, 5, 7–9), inside `withCompany`: the ledger head
 * `FOR UPDATE`, then the period row `FOR UPDATE`, then the checklist inside the same transaction,
 * so a posting, a release, a revaluation or a retry committed first is read. Refused in rule 2's
 * order: `PERIOD_CLOSED` (closed, or before the first period while a month is closed),
 * `PERIOD_NOT_ENDED`, `PERIOD_ORDER` (the earliest month from the first period not closed, or the
 * first period for a month before it, which a close would make the first for good) and
 * `CHECKLIST_FAILED` (the failing items, in the checklist's order). An empty month gets its row.
 * Writes the `period_events` row with the checklist, the state and the `period.closed` audit row.
 */
export async function closePeriod(
  tx: Transaction,
  input: {
    readonly period: string;
    readonly reason: string;
    readonly today: string;
    readonly actor: Person;
  },
): Promise<PeriodDetail> {
  const { period, reason, today, actor } = input;
  const head = await lockHead(tx);
  await lockPeriod(tx, period);
  if (isClosedPeriod(await readClosedPeriods(tx), period)) {
    throw new DomainError('PERIOD_CLOSED', `The period ${period} is closed`, { period });
  }
  // No month closes until the opening is posted (S10 rule 3).
  const [start] = await tx.select({ booksStart: companySettings.booksStart }).from(companySettings);
  if (start?.booksStart != null && !(await openingIsPosted(tx))) {
    throw new DomainError('OPENING_NOT_POSTED', 'The opening balances are not posted yet', {
      booksStart: start.booksStart,
    });
  }
  if (lastDayOfMonth(`${period}-01`) >= today) {
    throw new DomainError('PERIOD_NOT_ENDED', `The month ${period} has not ended`, { period });
  }
  const rows = await tx
    .select({ period: periods.period, state: periods.state })
    .from(periods)
    .orderBy(asc(periods.period));
  const first = rows[0]?.period;
  // A month before the company's first period is never closed on its own: it would become the
  // first period for good, and rule 4 closes every such month once a month is closed.
  if (first !== undefined && period < first) {
    throw new DomainError('PERIOD_ORDER', `${period} is before the first period ${first}`, {
      period: first,
    });
  }
  if (first !== undefined && first < period) {
    const open = monthsOf({ from: first, to: monthBefore(period) }).find(
      (month) => rows.find((candidate) => candidate.period === month)?.state !== 'closed',
    );
    if (open !== undefined) {
      throw new DomainError('PERIOD_ORDER', `Close ${open} before ${period}`, { period: open });
    }
  }
  const checklist = await periodChecklist(tx, period);
  const failing = failingItems(checklist);
  if (failing.length > 0) {
    throw new DomainError('CHECKLIST_FAILED', 'An item of the checklist fails', {
      items: failing.join(','),
    });
  }
  const periodId = await writePeriodTransition(tx, {
    companyId: head.companyId,
    period,
    kind: 'closed',
    reason,
    userId: actor.userId,
    checklist,
  });
  await writeCompanyAudit(tx, head.companyId, actor, {
    action: 'period.closed',
    entityType: 'period',
    entityId: periodId,
    reason,
    after: { period, checklist },
  });
  return readPeriod(tx, period, today);
}

/**
 * Reopens `period` with a reason (S07 rules 3, 5, 6), inside `withCompany`, in the close's lock
 * order. Refused `PERIOD_NOT_CLOSED` (not closed) and `PERIOD_ORDER` (a later month is closed: the
 * latest closed month). Writes the `period_events` row, the state `reopened` and the
 * `period.reopened` audit row.
 */
export async function reopenPeriod(
  tx: Transaction,
  input: {
    readonly period: string;
    readonly reason: string;
    readonly today: string;
    readonly actor: Person;
  },
): Promise<{ readonly period: PeriodDetail }> {
  const { period, reason, today, actor } = input;
  const head = await lockHead(tx);
  const row = await lockPeriod(tx, period);
  if (row?.state !== 'closed') {
    throw new DomainError('PERIOD_NOT_CLOSED', `The period ${period} is not closed`, { period });
  }
  const [latest] = await tx
    .select({ period: periods.period })
    .from(periods)
    .where(eq(periods.state, 'closed'))
    .orderBy(desc(periods.period))
    .limit(1);
  if (latest !== undefined && latest.period !== period) {
    throw new DomainError('PERIOD_ORDER', `Reopen ${latest.period} first`, {
      period: latest.period,
    });
  }
  await writePeriodTransition(tx, {
    companyId: head.companyId,
    period,
    kind: 'reopened',
    reason,
    userId: actor.userId,
    checklist: null,
  });
  await writeCompanyAudit(tx, row.companyId, actor, {
    action: 'period.reopened',
    entityType: 'period',
    entityId: row.id,
    reason,
    after: { period },
  });
  return { period: await readPeriod(tx, period, today) };
}
