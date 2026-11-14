import type { ReportMark } from '@vertex-mizan/contracts';
import {
  chartAccounts,
  dimensionTypes,
  dimensionValues,
  journalEntries,
  readAccountStatement,
  readBalanceSheet,
  readIncomeStatement,
  readJournalBook,
  readProfitability,
  readTrialBalance,
  setServiceDepartment,
  type Transaction,
  withCompany,
} from '@vertex-mizan/db';
import { and, eq } from 'drizzle-orm';
import { caseToday } from './clock.js';
import type { Step } from './format.js';
import type { CaseContext, StepResult } from './harness.js';
import type { ExpectedReport } from './report-format.js';
import { bookkeeperOf, outcomeOf } from './system.js';

/**
 * S09 in the book: the accountant's dated department of a manual service (rule 34), and each
 * stated report read through `packages/db`'s readers in the case's company, in one
 * repeatable-read snapshot, as the API reads them, with the case's clock as the time of reading
 * (`docs/scenarios/README.md`, "Reports"). Every stated figure is compared exactly; a figure the
 * case does not state is not, but a line or row not stated must be zero or absent where the
 * README says so.
 */

/** A value of a built-in type by the code a case names it with. */
async function valueIdOf(tx: Transaction, type: string, code: string): Promise<string> {
  const [found] = await tx
    .select({ id: dimensionValues.id })
    .from(dimensionValues)
    .innerJoin(dimensionTypes, eq(dimensionTypes.id, dimensionValues.typeId))
    .where(and(eq(dimensionTypes.code, type), eq(dimensionValues.code, code)));
  if (!found) throw new Error(`The case has no ${type} ${code}`);
  return found.id;
}

/** `service_department`: the accountant's row, as `/dimensions` sets it. */
export function serviceDepartment(
  context: CaseContext,
  step: Extract<Step, { kind: 'service_department' }>,
): Promise<StepResult> {
  const actor = bookkeeperOf(context.companyId);
  return outcomeOf(
    withCompany(context.database.app, context.companyId, async (tx) =>
      setServiceDepartment(tx, {
        serviceValueId: await valueIdOf(tx, 'service', step.service),
        departmentValueId: await valueIdOf(tx, 'department', step.department),
        effectiveFrom: step.effectiveFrom,
        reason: step.reason,
        actor,
      }),
    ),
  );
}

const big = (text: string | null) => (text === null ? null : BigInt(text));

/** The differences between stated and read figures, as readable lines. */
class Differences {
  readonly list: string[] = [];
  constructor(private readonly prefix: string) {}
  equal(what: string, read: unknown, stated: unknown): void {
    if (read !== stated) {
      this.list.push(`${this.prefix}: ${what} is ${String(read)}, not ${String(stated)}`);
    }
  }
  marks(what: string, read: readonly ReportMark[] | undefined, stated: readonly string[]): void {
    const a = [...(read ?? [])].sort().join(',');
    const b = [...stated].sort().join(',');
    this.equal(`${what} marks`, `[${a}]`, `[${b}]`);
  }
  note(text: string): void {
    this.list.push(`${this.prefix}: ${text}`);
  }
}

/** The case's entries by `(fiscal year, number)`, as their place in posting order. */
async function postingOrder(tx: Transaction): Promise<Map<string, number>> {
  const rows = await tx
    .select({
      fiscalYear: journalEntries.fiscalYear,
      number: journalEntries.number,
      sequence: journalEntries.sequence,
    })
    .from(journalEntries);
  return new Map(rows.map((row) => [`${row.fiscalYear}/${row.number}`, Number(row.sequence)]));
}

const nameOf = (value: { code: string | null; name: string } | null) =>
  value === null ? null : (value.code ?? value.name);

const dimsOf = (
  values: readonly ({ typeCode: string; code: string | null; name: string } | null)[],
) =>
  Object.fromEntries(
    values
      .filter((value) => value !== null)
      .map((value) => [value.typeCode, value.code ?? value.name]),
  );

const sameDims = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/** Reads one stated report and lists how it differs (`ScenarioHarness.reports`). */
export async function reports(
  context: CaseContext,
  stated: ExpectedReport,
): Promise<readonly string[]> {
  const now = new Date(`${caseToday(context.companyId)}T12:00:00Z`);
  return withCompany(
    context.database.app,
    context.companyId,
    async (tx) => {
      const diff = new Differences(
        `${stated.report} ${JSON.stringify(stated.params, (_key, value) => (typeof value === 'bigint' ? Number(value) : value))}`,
      );
      switch (stated.report) {
        case 'trial_balance': {
          const { params } = stated;
          const compared = params.compare_from !== undefined && params.compare_to !== undefined;
          const read = await readTrialBalance(
            tx,
            {
              from: params.from,
              to: params.to,
              ledger: params.ledger ?? 'book',
              level: params.level ?? 4,
              nonZero: params.non_zero ?? true,
              codeFrom: params.code_from,
              codeTo: params.code_to,
              compare: compared,
              compareFrom: params.compare_from,
              compareTo: params.compare_to,
            },
            now,
          );
          diff.marks('the', read.header.current.marks, stated.marks);
          if (stated.compareMarks !== null) {
            diff.marks('the comparative', read.header.compare?.marks, stated.compareMarks);
          }
          const rows = new Map(read.rows.map((row) => [row.account.code, row]));
          for (const row of stated.rows) {
            const found = rows.get(row.account);
            if (found === undefined) {
              diff.note(`no row for ${row.account}`);
              continue;
            }
            for (const key of ['opening', 'debits', 'credits', 'closing'] as const) {
              diff.equal(`${row.account} ${key}`, BigInt(found[key]), row[key]);
            }
          }
          if (params.non_zero !== false) {
            for (const code of rows.keys()) {
              if (!stated.rows.some((row) => row.account === code))
                diff.note(`an extra row ${code}`);
            }
          }
          for (const key of Object.keys(stated.totals) as (keyof typeof stated.totals)[]) {
            diff.equal(`totals ${key}`, BigInt(read.totals[key]), stated.totals[key]);
          }
          break;
        }
        case 'account_statement': {
          const { params } = stated;
          const [account] = await tx
            .select({ id: chartAccounts.id })
            .from(chartAccounts)
            .where(eq(chartAccounts.code, params.account));
          if (!account) return [`no account ${params.account}`];
          const dims: string[] = [];
          for (const [type, code] of Object.entries(params.dims ?? {})) {
            dims.push(await valueIdOf(tx, type, code));
          }
          const order = await postingOrder(tx);
          const lines = [];
          let cursor: string | undefined;
          let first: Awaited<ReturnType<typeof readAccountStatement>> | null = null;
          do {
            const page = await readAccountStatement(
              tx,
              account.id,
              {
                from: params.from,
                to: params.to,
                ledger: params.ledger ?? 'book',
                dims,
                currency: params.currency as never,
                cursor,
              },
              now,
            );
            first ??= page;
            lines.push(...page.lines);
            cursor = page.nextCursor ?? undefined;
          } while (cursor !== undefined);
          diff.marks('the', first.header.current.marks, stated.marks);
          diff.equal('opening', BigInt(first.opening), stated.opening);
          diff.equal('closing', BigInt(first.closing), stated.closing);
          diff.equal('line count', lines.length, stated.lines.length);
          for (const [index, line] of stated.lines.entries()) {
            const found = lines[index];
            if (found === undefined) continue;
            diff.equal(
              `line ${index + 1} entry`,
              order.get(`${found.fiscalYear}/${found.number}`),
              line.entry,
            );
            diff.equal(`line ${index + 1} date`, found.entryDate, line.date);
            diff.equal(`line ${index + 1} amount`, BigInt(found.amount), line.amount);
            diff.equal(`line ${index + 1} balance`, BigInt(found.balance), line.balance);
            diff.equal(`line ${index + 1} currency`, found.currency, line.currency);
            diff.equal(
              `line ${index + 1} transaction amount`,
              BigInt(found.transactionAmount),
              line.transactionAmount,
            );
            diff.equal(
              `line ${index + 1} transaction balance`,
              BigInt(found.transactionBalance),
              line.transactionBalance,
            );
          }
          diff.equal(
            'currencies',
            first.currencies
              .map((row) => `${row.currency}:${row.opening}:${row.closing}`)
              .join(','),
            stated.currencies
              .map((row) => `${row.currency}:${row.opening}:${row.closing}`)
              .join(','),
          );
          break;
        }
        case 'income_statement': {
          const { params } = stated;
          const compared = params.compare_from !== undefined && params.compare_to !== undefined;
          const read = await readIncomeStatement(
            tx,
            {
              from: params.from,
              to: params.to,
              ledger: params.ledger ?? 'book',
              compare: compared,
              compareFrom: params.compare_from,
              compareTo: params.compare_to,
            },
            now,
          );
          diff.marks('the', read.header.current.marks, stated.marks);
          if (stated.compareMarks !== null) {
            diff.marks('the comparative', read.header.compare?.marks, stated.compareMarks);
          }
          for (const line of read.lines) {
            const own = stated.lines.find((candidate) => candidate.line === line.line);
            diff.equal(`${line.line}`, BigInt(line.amount), own?.amount ?? 0n);
            if (compared) diff.equal(`${line.line} compare`, big(line.compare), own?.compare ?? 0n);
          }
          for (const line of stated.lines) {
            if (
              !read.lines.some((candidate) => candidate.line === line.line) &&
              line.amount !== 0n
            ) {
              diff.note(`no line ${line.line}`);
            }
          }
          type Subtotals = Awaited<ReturnType<typeof readIncomeStatement>>['subtotals'];
          const subtotals = (
            got: Subtotals | null,
            want: NonNullable<typeof stated.compareSubtotals>,
            what: string,
          ) => {
            diff.equal(
              `${what} operating profit`,
              big(got?.operatingProfit ?? null),
              want.operatingProfit,
            );
            diff.equal(
              `${what} profit before financing and income taxes`,
              big(got?.profitBeforeFinancingAndIncomeTaxes ?? null),
              want.profitBeforeFinancingAndIncomeTaxes,
            );
            diff.equal(
              `${what} profit before tax`,
              big(got?.profitBeforeTax ?? null),
              want.profitBeforeTax,
            );
            diff.equal(`${what} profit`, big(got?.profit ?? null), want.profit);
          };
          subtotals(read.subtotals, stated.subtotals, 'the');
          if (stated.compareSubtotals !== null) {
            subtotals(read.compareSubtotals, stated.compareSubtotals, 'the comparative');
          }
          break;
        }
        case 'balance_sheet': {
          const { params } = stated;
          const read = await readBalanceSheet(
            tx,
            {
              asOf: params.as_of,
              ledger: params.ledger ?? 'book',
              compare: params.compare_as_of !== undefined,
              compareAsOf: params.compare_as_of,
            },
            now,
          );
          diff.marks('the', read.header.current.marks, stated.marks);
          if (stated.compareMarks !== null) {
            diff.marks('the comparative', read.header.compare?.marks, stated.compareMarks);
          }
          for (const line of read.lines) {
            const own = stated.lines.find((candidate) => candidate.line === line.line);
            if (own === undefined) {
              diff.equal(`${line.line}`, BigInt(line.amount), 0n);
              continue;
            }
            diff.equal(`${line.line}`, BigInt(line.amount), own.amount);
            if (own.compare !== null)
              diff.equal(`${line.line} compare`, big(line.compare), own.compare);
            if (own.unclosedYears !== null) {
              diff.equal(`${line.line} unclosed years`, big(line.unclosedYears), own.unclosedYears);
            }
            if (own.compareUnclosedYears !== null) {
              diff.equal(
                `${line.line} comparative unclosed years`,
                big(line.compareUnclosedYears),
                own.compareUnclosedYears,
              );
            }
            // The parts: every stated one (absent reads as zero), and no unstated one but zeros.
            const parts = line.parts.map((part) => ({
              account: part.account.code,
              dims: dimsOf([part.client, part.contract]),
              amount: BigInt(part.amount),
              reclassified: part.reclassified,
            }));
            for (const part of own.parts) {
              const found = parts.find(
                (candidate) =>
                  candidate.account === part.account && sameDims(candidate.dims, part.dims),
              );
              const what = `${line.line} part ${part.account} ${JSON.stringify(part.dims)}`;
              diff.equal(what, found?.amount ?? 0n, part.amount);
              if (found !== undefined)
                diff.equal(`${what} reclassified`, found.reclassified, part.reclassified);
            }
            for (const part of parts) {
              const listed = own.parts.some(
                (candidate) =>
                  candidate.account === part.account && sameDims(candidate.dims, part.dims),
              );
              if (!listed)
                diff.note(
                  `${line.line} has an extra part ${part.account} ${JSON.stringify(part.dims)} of ${part.amount}`,
                );
            }
          }
          for (const line of stated.lines) {
            if (!read.lines.some((candidate) => candidate.line === line.line))
              diff.note(`no line ${line.line}`);
          }
          diff.equal('the year result', BigInt(read.yearResult), stated.yearResult);
          // S10 rule 31: the result before the books start that the year's result includes.
          if (stated.yearResultPreOpening !== null) {
            diff.equal(
              'the year result before the books start',
              BigInt(read.yearResultPreOpening),
              stated.yearResultPreOpening,
            );
          }
          if (stated.compareYearResultPreOpening !== null) {
            diff.equal(
              'the comparative year result before the books start',
              big(read.compareYearResultPreOpening),
              stated.compareYearResultPreOpening,
            );
          }
          if (stated.compareYearResult !== null) {
            diff.equal(
              'the comparative year result',
              big(read.compareYearResult),
              stated.compareYearResult,
            );
          }
          for (const key of ['assets', 'liabilities', 'equity', 'liabilitiesAndEquity'] as const) {
            diff.equal(`totals ${key}`, BigInt(read.totals[key]), stated.totals[key]);
            if (stated.compareTotals !== null) {
              diff.equal(
                `comparative totals ${key}`,
                big(read.compareTotals?.[key] ?? null),
                stated.compareTotals[key],
              );
            }
          }
          break;
        }
        case 'profitability': {
          const { params } = stated;
          const compared = params.compare_from !== undefined && params.compare_to !== undefined;
          const read = await readProfitability(
            tx,
            {
              by: params.by,
              from: params.from,
              to: params.to,
              ledger: params.ledger,
              compare: compared,
              compareFrom: params.compare_from,
              compareTo: params.compare_to,
            },
            now,
          );
          diff.marks('the', read.header.current.marks, stated.marks);
          if (stated.compareMarks !== null) {
            diff.marks('the comparative', read.header.compare?.marks, stated.compareMarks);
          }
          const figures = (
            what: string,
            got: (typeof read)['totals']['current'],
            want: {
              revenue: bigint;
              directCosts: bigint;
              contribution: bigint;
              margin: string | null;
            },
          ) => {
            diff.equal(`${what} revenue`, BigInt(got.revenue), want.revenue);
            diff.equal(`${what} direct costs`, BigInt(got.directCosts), want.directCosts);
            diff.equal(`${what} contribution`, BigInt(got.contribution), want.contribution);
            diff.equal(`${what} margin`, got.margin, want.margin);
          };
          const rows = new Map(read.rows.map((row) => [nameOf(row.value) ?? 'unassigned', row]));
          for (const row of stated.rows) {
            const found = rows.get(row.value);
            if (found === undefined) diff.note(`no row ${row.value}`);
            else figures(row.value, found.current, row);
          }
          for (const value of rows.keys()) {
            if (!stated.rows.some((row) => row.value === value)) diff.note(`an extra row ${value}`);
          }
          figures('totals', read.totals.current, stated.totals);
          break;
        }
        case 'journal_book': {
          const { params } = stated;
          const read = await readJournalBook(
            tx,
            { fiscalYear: params.fiscalYear, from: params.from, to: params.to, ledger: 'book' },
            now,
          );
          const order = await postingOrder(tx);
          diff.marks('the', read.header.current.marks, stated.marks);
          diff.equal('official', read.official, params.official);
          diff.equal('page count', read.pages.length, stated.pages.length);
          for (const [index, page] of stated.pages.entries()) {
            const found = read.pages[index];
            if (found === undefined) continue;
            const what = `page ${page.page}`;
            diff.equal(`${what} number`, found.page, page.page);
            const entries = found.rows.flatMap((row) =>
              row.kind === 'entry' || row.kind === 'continued'
                ? [order.get(`${params.fiscalYear}/${row.number}`)]
                : [],
            );
            diff.equal(`${what} entries`, entries.join(','), page.entries.join(','));
            diff.equal(`${what} debits`, BigInt(found.totals.debits), page.debits);
            diff.equal(`${what} credits`, BigInt(found.totals.credits), page.credits);
            diff.equal(
              `${what} brought forward debits`,
              BigInt(found.broughtForward.debits),
              page.broughtForward.debits,
            );
            diff.equal(
              `${what} brought forward credits`,
              BigInt(found.broughtForward.credits),
              page.broughtForward.credits,
            );
            diff.equal(
              `${what} cumulative debits`,
              BigInt(found.cumulative.debits),
              page.cumulative.debits,
            );
            diff.equal(
              `${what} cumulative credits`,
              BigInt(found.cumulative.credits),
              page.cumulative.credits,
            );
          }
          break;
        }
      }
      return diff.list;
    },
    { isolationLevel: 'repeatable read' },
  );
}
