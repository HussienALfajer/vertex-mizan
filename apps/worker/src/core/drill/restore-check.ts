import { type Database, readChain, readLedgerState, withCompany } from '@vertex-mizan/db';
import { checkIntegrity } from '@vertex-mizan/ledger';
import { sql } from 'drizzle-orm';

/**
 * The checks of the monthly restore drill (ADR 0020, `docs/operations/restore-drills.md`): the
 * latest off-server backup, restored into a temporary cluster, is compared with production, company
 * by company. Read-only on both sides, through the app role in each company's context and the jobs
 * role to list the companies, as the jobs do (`apps/worker/CLAUDE.md`).
 *
 * The restore stops at the end of the archived write-ahead log, so it holds a prefix of every
 * company's chain. A company's entries are numbered by `sequence` under the head's lock, in commit
 * order, so "the same prefix" is exact: production's entries up to the restored head's sequence.
 */

/** One account's movements in one currency, summed over a prefix of the chain. */
export interface TrialBalanceRow {
  readonly accountId: string;
  readonly currency: string;
  readonly amountMinor: string;
  readonly bookMinor: string;
  readonly parallelMinor: string | null;
}

/** What the drill found in one company; `problems` is empty when the restore is sound. */
export interface CompanyDrillResult {
  readonly companyId: string;
  readonly entryCount: number;
  readonly headSequence: string | null;
  readonly problems: readonly string[];
}

/** The whole drill's result. */
export interface DrillResult {
  readonly ok: boolean;
  readonly companies: readonly CompanyDrillResult[];
  readonly problems: readonly string[];
}

/**
 * How long before the restored moment an entry must be in the restore. Inside this margin an entry
 * whose transaction started earlier may have committed after the restore's end.
 */
export const COMMIT_MARGIN_MS = 5 * 60_000;

const key = (row: TrialBalanceRow) => `${row.accountId} ${row.currency}`;
const amounts = (row: TrialBalanceRow) =>
  `${row.amountMinor}/${row.bookMinor}/${row.parallelMinor ?? '-'}`;

/** The differences between two trial balances of the same prefix, one line each, in key order. */
export function compareTrialBalances(
  production: readonly TrialBalanceRow[],
  restored: readonly TrialBalanceRow[],
): string[] {
  const left = new Map(production.map((row) => [key(row), amounts(row)]));
  const right = new Map(restored.map((row) => [key(row), amounts(row)]));
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  return keys
    .filter((name) => left.get(name) !== right.get(name))
    .map(
      (name) =>
        `trial balance ${name}: production ${left.get(name) ?? 'none'}, restored ${right.get(name) ?? 'none'}`,
    );
}

/** The trial balance of a company's entries up to `sequence` (all of them when null). */
async function trialBalance(
  db: Database,
  companyId: string,
  sequence: string | null,
): Promise<TrialBalanceRow[]> {
  return withCompany(db, companyId, async (tx) => {
    const { rows } = await tx.execute<{
      account_id: string;
      currency: string;
      amount: string;
      book: string;
      parallel: string | null;
    }>(sql`
      select l.account_id, l.currency, sum(l.amount_minor)::text as amount,
        sum(l.book_minor)::text as book, sum(l.parallel_minor)::text as parallel
      from journal_lines l
      join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
      where ${sequence === null ? sql`true` : sql`e.sequence <= ${sequence}::bigint`}
      group by l.account_id, l.currency
      order by l.account_id, l.currency`);
    return rows.map((row) => ({
      accountId: row.account_id,
      currency: row.currency,
      amountMinor: row.amount,
      bookMinor: row.book,
      parallelMinor: row.parallel,
    }));
  });
}

/** Production's entry at `sequence`, and the last sequence posted before `before`. */
async function productionAt(
  db: Database,
  companyId: string,
  sequence: string | null,
  before: Date,
): Promise<{ hash: string | null; lastBefore: string | null }> {
  return withCompany(db, companyId, async (tx) => {
    const at =
      sequence === null
        ? []
        : (
            await tx.execute<{ hash: string }>(
              sql`select hash from journal_entries where sequence = ${sequence}::bigint`,
            )
          ).rows;
    const [last] = (
      await tx.execute<{ sequence: string | null }>(
        sql`select max(sequence)::text as sequence from journal_entries
          where posted_at < ${before.toISOString()}::timestamptz`,
      )
    ).rows;
    return { hash: at[0]?.hash ?? null, lastBefore: last?.sequence ?? null };
  });
}

async function companyIds(jobs: Database): Promise<string[]> {
  const { rows } = await jobs.execute<{ id: string }>(sql`select id from companies order by id`);
  return rows.map((row) => row.id);
}

/** Checks one company of the restore against production. */
async function checkCompany(
  databases: DrillDatabases,
  companyId: string,
  restoredAt: Date,
): Promise<CompanyDrillResult> {
  const problems: string[] = [];
  // The restored company whole: its chain from the first entry, every entry balanced in both
  // ledgers, its numbering and its head, through the same check as `POST /api/integrity/check`.
  const restored = await withCompany(
    databases.restored,
    companyId,
    async (tx) => {
      const chain = await readChain(tx);
      const state = await readLedgerState(tx);
      const last = chain.at(-1);
      return {
        findings: checkIntegrity({ chain, ...state }),
        last: last ? { sequence: last.entry.sequence.toString(), hash: last.hash } : null,
      };
    },
    { isolationLevel: 'repeatable read' },
  );
  const { findings, last } = restored;
  if (findings.firstBreak !== null) {
    problems.push(
      `chain breaks at sequence ${findings.firstBreak.sequence}: ${findings.firstBreak.reason}`,
    );
  }
  if (!findings.headMatchesChain) problems.push('the head does not match the chain');
  for (const entry of findings.unbalanced) {
    problems.push(
      `entry ${entry.fiscalYear}/${entry.number} unbalanced in the ${entry.ledger} ledger`,
    );
  }
  if (findings.numbering.length > 0) {
    problems.push(`${findings.numbering.length} numbering problems`);
  }

  const headSequence = last?.sequence ?? null;
  const production = await productionAt(
    databases.production,
    companyId,
    headSequence,
    new Date(restoredAt.getTime() - COMMIT_MARGIN_MS),
  );
  if (headSequence !== null && production.hash !== last?.hash) {
    problems.push(`the restored head ${headSequence} is not production's entry at that place`);
  }
  // An entry committed well before the restored moment that the restore lacks: the archive of
  // the write-ahead log has a gap, or the restore stopped early.
  if (
    production.lastBefore !== null &&
    (headSequence === null || BigInt(production.lastBefore) > BigInt(headSequence))
  ) {
    problems.push(
      `production's entry ${production.lastBefore}, posted before the restored moment, is missing`,
    );
  }
  problems.push(
    ...compareTrialBalances(
      await trialBalance(databases.production, companyId, headSequence ?? '0'),
      await trialBalance(databases.restored, companyId, null),
    ),
  );
  return { companyId, entryCount: findings.entryCount, headSequence, problems };
}

/** The databases the drill reads: production's and the restore's, each as the app and jobs roles. */
export interface DrillDatabases {
  readonly production: Database;
  readonly productionJobs: Database;
  readonly restored: Database;
  readonly restoredJobs: Database;
}

/**
 * Checks every company of the restore against production. `restoredAt` is the restore's last
 * replayed commit; `now` and `maxAgeMs` bound how old it may be, so a stalled archive fails.
 */
export async function checkRestore(
  databases: DrillDatabases,
  restoredAt: Date,
  now: Date,
  maxAgeMs: number,
): Promise<DrillResult> {
  const problems: string[] = [];
  if (now.getTime() - restoredAt.getTime() > maxAgeMs) {
    problems.push(
      `the restore ends at ${restoredAt.toISOString()}, older than ${maxAgeMs / 3_600_000} hours`,
    );
  }
  const inProduction = await companyIds(databases.productionJobs);
  const inRestore = new Set(await companyIds(databases.restoredJobs));
  const companies: CompanyDrillResult[] = [];
  for (const companyId of inProduction) {
    if (!inRestore.has(companyId)) {
      // Missing is a failure only when the company had posted before the restored moment.
      const { lastBefore } = await productionAt(
        databases.production,
        companyId,
        null,
        new Date(restoredAt.getTime() - COMMIT_MARGIN_MS),
      );
      if (lastBefore !== null) problems.push(`company ${companyId} is missing from the restore`);
      continue;
    }
    companies.push(await checkCompany(databases, companyId, restoredAt));
  }
  for (const companyId of inRestore) {
    if (!inProduction.includes(companyId)) {
      problems.push(`company ${companyId} is in the restore but not in production`);
    }
  }
  return {
    ok: problems.length === 0 && companies.every((company) => company.problems.length === 0),
    companies,
    problems,
  };
}
