import { balanceQuery, compareBalance, compareEntries, compareOpenItem } from './compare.js';
import type { Outcome, ScenarioCase, Step, StepKind } from './format.js';
import type { CaseContext, ScenarioDatabase, ScenarioHarness, StepResult } from './harness.js';

/** The feature each kind of step arrives with (`docs/ROADMAP.md`). */
export const STEPS_ARRIVE_WITH = {
  manual: 'manual entries arrive with S03',
  reversal: 'reversals arrive with S03',
  rate: 'rate steps arrive with S03, on the S02 rate table',
  revalue: 'the month-end revaluation arrives with S07',
  block: 'blocking an account in the book arrives with S07',
  close: 'closing a period arrives with S07',
  reopen: 'reopening a period arrives with S07',
  draft: "saving a draft in the book arrives with S07's checklist",
  discard: "discarding a draft in the book arrives with S07's checklist",
  service_department: "a manual service's department arrives with S09",
  opening: 'the opening arrives with S10',
  reverse_opening: "the opening's whole reversal arrives with S10",
  voucher: 'cash vouchers arrive with S11',
} as const satisfies Record<StepKind, string>;

/** A case that did not do what its scenario states: every difference, one per line. */
export class ScenarioFailure extends Error {
  constructor(readonly differences: readonly string[]) {
    super(differences.map((difference) => `- ${difference}`).join('\n'));
    this.name = 'ScenarioFailure';
  }
}

type Run = (context: CaseContext) => Promise<StepResult>;

/** A dimension value a case names: its type's code and its own code (`client: C1`). */
export type NamedValue = { readonly type: string; readonly code: string };

/**
 * Every dimension value a case names, in the order first named: in its manual steps' lines, its
 * expected lines, balances and open items. The setup makes each one, so a case states its values by
 * code and never creates them in a step (S04).
 */
export function namedDimensionValues(scenarioCase: ScenarioCase): NamedValue[] {
  const named = new Map<string, NamedValue>();
  const keyOf = (type: string, code: string) => JSON.stringify([type, code]);
  const add = (dims: unknown) => {
    if (typeof dims !== 'object' || dims === null) return;
    for (const [type, code] of Object.entries(dims)) {
      if (typeof code !== 'string') continue;
      const key = keyOf(type, code);
      if (!named.has(key)) named.set(key, { type, code });
    }
  };
  for (const step of scenarioCase.steps) {
    if (step.kind === 'service_department') {
      add({ service: step.service, department: step.department });
    }
    // The accountant's opening lines (S10 rule 14).
    if (step.kind === 'opening') {
      for (const line of step.lines) add(line.dims);
      continue;
    }
    if (step.kind !== 'manual' && step.kind !== 'draft' && step.kind !== 'voucher') continue;
    const lines = (step.payload as { lines?: unknown }).lines;
    if (Array.isArray(lines)) {
      for (const line of lines) add((line as { dims?: unknown }).dims);
    }
  }
  const { expect } = scenarioCase;
  for (const entry of expect.entries) for (const line of entry.lines) add(line.dims);
  for (const balance of expect.balances) add(balance.dims);
  for (const item of expect.openItems) add(item.dims);
  return [...named.values()];
}

function executorFor(harness: ScenarioHarness, step: Step): Run | undefined {
  switch (step.kind) {
    case 'manual': {
      const execute = harness.executors.manual;
      return execute && ((context) => execute(context, step));
    }
    case 'reversal': {
      const execute = harness.executors.reversal;
      return execute && ((context) => execute(context, step));
    }
    case 'rate': {
      const execute = harness.executors.rate;
      return execute && ((context) => execute(context, step));
    }
    case 'revalue': {
      const execute = harness.executors.revalue;
      return execute && ((context) => execute(context, step));
    }
    case 'block': {
      const execute = harness.executors.block;
      return execute && ((context) => execute(context, step));
    }
    case 'close': {
      const execute = harness.executors.close;
      return execute && ((context) => execute(context, step));
    }
    case 'reopen': {
      const execute = harness.executors.reopen;
      return execute && ((context) => execute(context, step));
    }
    case 'draft': {
      const execute = harness.executors.draft;
      return execute && ((context) => execute(context, step));
    }
    case 'discard': {
      const execute = harness.executors.discard;
      return execute && ((context) => execute(context, step));
    }
    case 'service_department': {
      const execute = harness.executors.service_department;
      return execute && ((context) => execute(context, step));
    }
    case 'opening': {
      const execute = harness.executors.opening;
      return execute && ((context) => execute(context, step));
    }
    case 'reverse_opening': {
      const execute = harness.executors.reverse_opening;
      return execute && ((context) => execute(context, step));
    }
    case 'voucher': {
      const execute = harness.executors.voucher;
      return execute && ((context) => execute(context, step));
    }
  }
}

function describeStep(step: Step): string {
  switch (step.kind) {
    case 'manual':
      return `manual entry "${step.description}" on ${step.accountingDate}`;
    case 'reversal':
      return `reversal of entry ${step.entry} on ${step.accountingDate}`;
    case 'rate': {
      const { type, base, quote, rate, effectiveOn } = step.rate;
      const what = step.reason === null ? 'rate' : 'rate correction';
      return `${what} ${type} ${base}/${quote} ${rate} on ${effectiveOn}`;
    }
    case 'revalue':
      return `revaluation of the ${step.ledger} ledger for ${step.period}`;
    case 'block':
      return `block of account ${step.account}`;
    case 'close':
      return `close of ${step.period}`;
    case 'reopen':
      return `reopen of ${step.period}`;
    case 'draft':
      return `draft: ${step.description}`;
    case 'discard':
      return `discard of the draft of step ${step.step}`;
    case 'service_department':
      return `department ${step.department} of service ${step.service} from ${step.effectiveFrom}`;
    case 'opening':
      return `opening: ${step.description}`;
    case 'reverse_opening':
      return 'whole reversal of the opening';
    case 'voucher':
      return `voucher "${step.description}" on ${step.accountingDate}`;
  }
}

function describeResult(result: StepResult | Outcome): string {
  if (result.status === 'done') return 'done';
  const detail = result.detail ? ` (${result.detail})` : '';
  return `${result.status} ${result.reason}${detail}`;
}

/** A stated detail must match; an unstated one is not compared. */
function sameResult(result: StepResult, expected: StepResult | Outcome): boolean {
  if (result.status === 'done' || expected.status === 'done')
    return result.status === expected.status;
  if (result.status !== expected.status || result.reason !== expected.reason) return false;
  return !expected.detail || result.detail === expected.detail;
}

/**
 * Runs one `Approved` case on the run's database and throws a `ScenarioFailure` listing every
 * difference. Before anything runs, every part the case needs must be in the harness: an approved
 * step with no executor fails the case, never skips it. Each step must be done when received, except
 * a step that states its `outcome`, and the last when the case states one in `expect`: such a step
 * must be held or refused with that reason, and that detail when stated. A held step a later step
 * frees posts then, so its entry is expected where it posts. Then
 * the ledger must hold exactly the expected entries (`compareEntries`), the stated balances and
 * the stated open items, each stated correction's answer must list exactly its entries, and each
 * stated report must present its figures (S09).
 */
export async function runCase(
  scenarioCase: ScenarioCase,
  harness: ScenarioHarness,
  database: ScenarioDatabase,
): Promise<void> {
  const missing: string[] = [];
  if (!harness.setUp)
    missing.push('No company setup is registered (packages/scenarios/src/harness.ts)');
  if (!harness.ledger)
    missing.push('No ledger reader is registered (packages/scenarios/src/harness.ts)');
  const runs: Run[] = [];
  for (const [index, step] of scenarioCase.steps.entries()) {
    const run = executorFor(harness, step);
    if (run) runs.push(run);
    else {
      missing.push(
        `step ${index + 1} (${describeStep(step)}): no executor for ${step.kind} steps; ` +
          STEPS_ARRIVE_WITH[step.kind],
      );
    }
  }
  if (scenarioCase.expect.reports.length > 0 && !harness.reports) {
    missing.push(
      'No report reader is registered (packages/scenarios/src/harness.ts); reports arrive with S09',
    );
  }
  if (!harness.setUp || !harness.ledger || missing.length > 0) throw new ScenarioFailure(missing);

  const { company, rates, steps, expect } = scenarioCase;
  const companyId = await harness.setUp(
    database,
    company,
    rates,
    namedDimensionValues(scenarioCase),
  );
  const context: CaseContext = { database, companyId, company };
  const differences: string[] = [];
  const corrections = new Map(expect.corrections.map((c) => [c.step, c.usedBy]));

  for (const [index, run] of runs.entries()) {
    const result = await run({ ...context, step: index + 1 });
    const usedBy = corrections.get(index + 1);
    if (usedBy !== undefined && result.status === 'done') {
      const listed = [...(result.usedBy ?? [])].sort((a, b) => a - b);
      const stated = [...usedBy].sort((a, b) => a - b);
      if (listed.join() !== stated.join()) {
        differences.push(
          `step ${index + 1} (${describeStep(steps[index] as Step)}): lists entries ` +
            `[${listed.join(', ')}], expected [${stated.join(', ')}]`,
        );
      }
    }
    const step = steps[index] as Step;
    const last = index === runs.length - 1;
    const expected: StepResult | Outcome =
      step.outcome ?? ((last && expect.outcome) || { status: 'done' });
    if (!sameResult(result, expected)) {
      differences.push(
        `step ${index + 1} (${describeStep(step)}): ${describeResult(result)}, ` +
          `expected ${describeResult(expected)}`,
      );
    }
  }

  differences.push(...compareEntries(expect.entries, await harness.ledger.entries(context)));
  for (const balance of expect.balances) {
    const observed = await harness.ledger.balance(context, balanceQuery(balance));
    differences.push(...compareBalance(balance, observed));
  }
  for (const openItem of expect.openItems) {
    const query = { item: openItem.item, account: openItem.account };
    differences.push(...compareOpenItem(openItem, await harness.ledger.openItem(context, query)));
  }
  for (const report of expect.reports) {
    differences.push(...((await harness.reports?.(context, report)) ?? []));
  }
  if (differences.length > 0) throw new ScenarioFailure(differences);
}
