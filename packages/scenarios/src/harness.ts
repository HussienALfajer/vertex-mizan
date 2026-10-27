import type { ExchangeRate } from '@vertex-mizan/contracts';
import type { Database } from '@vertex-mizan/db';
import type {
  CaseCompany,
  ExpectedBalance,
  ExpectedLine,
  ExpectedOpenItem,
  Step,
  StepKind,
} from './format.js';

/**
 * The run's fresh database as the runtime roles reach it, the way the API and the worker connect
 * (`createDatabase`). The runner never hands out the owner: a case runs through what the system
 * itself runs, the real posting function included, never a mock (ADR 0005).
 */
export type ScenarioDatabase = { app: Database; jobs: Database };

/** One case's company in the run's database. */
export type CaseContext = { database: ScenarioDatabase; companyId: string; company: CaseCompany };

/**
 * What a step did: posted (or ran) everything it had to, or was held or refused with a code. A
 * rate correction's answer also lists the entries that converted at the superseded row, by their
 * number in the company's posting order (S02 rule 15).
 */
export type StepResult =
  | { status: 'done'; usedBy?: readonly number[] }
  | { status: 'held' | 'refused'; reason: string };

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

/** One document's open item on a control account. */
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
 * rate table (S02, registered with S03's setup), Hub events with the event inbox (S05), jobs with
 * month-end and close (S07). An `Approved` case that needs a part not yet here fails (`run.ts`).
 */
export type ScenarioHarness = {
  /**
   * Creates the case's company (ledgers, template, closed periods, bulletin calendar) and its
   * rates; its id.
   */
  setUp?: (
    database: ScenarioDatabase,
    company: CaseCompany,
    rates: readonly ExchangeRate[],
  ) => Promise<string>;
  executors: StepExecutors;
  ledger?: LedgerReader;
};

/** The harness the book runs with. Nothing is registered until S03. */
export const bookHarness: ScenarioHarness = { executors: {} };
