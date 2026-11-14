import type { ExchangeRate } from '@vertex-mizan/contracts';
import type { Database } from '@vertex-mizan/db';
import type {
  CaseCompany,
  ExpectedBalance,
  ExpectedLine,
  ExpectedOpenItem,
  ExpectedVoucher,
  Step,
  StepKind,
} from './format.js';
import { opening, reverse as reverseOpening } from './opening.js';
import type { ExpectedReport } from './report-format.js';
import { reports, serviceDepartment } from './reports.js';
import type { NamedValue } from './run.js';
import {
  block,
  close,
  discard,
  draft,
  ledger,
  manual,
  rate,
  reopen,
  revalue,
  reversal,
  setUp,
} from './system.js';

/**
 * The run's fresh database as the runtime roles reach it, the way the API and the worker connect
 * (`createDatabase`). The runner never hands out the owner: a case runs through what the system
 * itself runs, the real posting function included, never a mock (ADR 0005).
 */
export type ScenarioDatabase = { app: Database; jobs: Database };

/** One case's company in the run's database, and the number of the step that runs (1-based). */
export type CaseContext = {
  database: ScenarioDatabase;
  companyId: string;
  company: CaseCompany;
  step?: number;
};

/**
 * What a step did when it was received: posted (or ran) everything it had to, or was refused with
 * a code and its detail. A rate correction's answer also
 * lists the entries that converted at the superseded row, by their number in the company's posting
 * order (S02 rule 15).
 */
export type StepResult =
  | { status: 'done'; usedBy?: readonly number[] }
  | { status: 'held' | 'refused'; reason: string; detail?: string | null };

export type StepExecutor<Kind extends StepKind> = (
  context: CaseContext,
  step: Extract<Step, { kind: Kind }>,
) => Promise<StepResult>;

export type StepExecutors = { [Kind in StepKind]?: StepExecutor<Kind> };

/** A posted line, in the scenario's terms: the account code, the dimensions by name. */
export type PostedLine = ExpectedLine;

/** A posted entry with its lines and the number of audit rows its posting wrote. */
export type PostedEntry = {
  source: string;
  date: string;
  lines: PostedLine[];
  auditRows: number;
};

/**
 * An account's balance over every dimension set that holds the pairs of `dims` (none: the whole
 * account), and over the lines of `currency` only when one is named.
 */
export type BalanceQuery = Pick<ExpectedBalance, 'account' | 'dims' | 'currency'>;

/** `amount` is the transaction amount, read when the query names a currency. */
export type ObservedBalance = { amount: bigint | null; book: bigint; parallel: bigint | null };

/** One document's open item on a control account; a running item is named by its client's code. */
export type OpenItemQuery = Pick<ExpectedOpenItem, 'item' | 'account'>;

/** What remains of an open item, with its dimensions and currency. */
export type ObservedOpenItem = Omit<ExpectedOpenItem, 'item' | 'account'>;

/** Reads what the company's ledger holds, from the database, as the reports will. */
export type LedgerReader = {
  /** Every entry the company has, in posting order. */
  entries: (context: CaseContext) => Promise<PostedEntry[]>;
  balance: (context: CaseContext, query: BalanceQuery) => Promise<ObservedBalance>;
  /** `null` when the company has no such open item. */
  openItem: (context: CaseContext, query: OpenItemQuery) => Promise<ObservedOpenItem | null>;
};

/**
 * What runs a case. Each part plugs in with the feature that brings it: the company setup, the
 * ledger reader, manual entries and reversals with the posting function (S03), rate steps with the
 * rate table (S02, registered with S03's setup), month-end and close (S07). An `Approved` case that needs a part not yet here fails (`run.ts`).
 */
export type ScenarioHarness = {
  /**
   * Creates the case's company (ledgers, template and the accounts added to it, closed periods,
   * bulletin calendar), its rates and the dimension values it names (S04); its id.
   */
  setUp?: (
    database: ScenarioDatabase,
    company: CaseCompany,
    rates: readonly ExchangeRate[],
    values: readonly NamedValue[],
  ) => Promise<string>;
  executors: StepExecutors;
  ledger?: LedgerReader;
  /**
   * Reads one stated report in the case's company and lists how it differs from the stated
   * figures (S09); a case that states a report needs it.
   */
  reports?: (context: CaseContext, report: ExpectedReport) => Promise<readonly string[]>;
  /**
   * Reads every cash voucher the company holds (S11 rules 9–14), its entry and its cancelling
   * reversal by their place in posting order; a case that states its vouchers needs it.
   */
  vouchers?: (context: CaseContext) => Promise<ObservedVoucher[]>;
};

/** A cash voucher as the company holds it: the fields a case states (`ExpectedVoucher`). */
export type ObservedVoucher = ExpectedVoucher;

/**
 * The harness the book runs with: S03's company setup, ledger reader and `manual`, `reversal` and
 * `rate` executors (`system.ts`), with S04's dimension values, item lines and open-item reader;
 * S07's `revalue` and
 * `block` (its first PR), then `close`, `reopen`, `draft` and `discard` and the setup's closed
 * periods through the close service (its second); S09's `service_department` and the `reports`
 * reader (`reports.ts`).
 */
export const bookHarness: ScenarioHarness = {
  setUp,
  executors: {
    manual,
    reversal,
    rate,
    revalue,
    block,
    close,
    reopen,
    draft,
    discard,
    service_department: serviceDepartment,
    opening,
    reverse_opening: reverseOpening,
  },
  ledger,
  reports,
};
