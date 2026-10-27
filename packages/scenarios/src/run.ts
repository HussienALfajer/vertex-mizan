import { balanceQuery, compareBalance, compareEntries, compareOpenItem } from './compare.js';
import type { Outcome, ScenarioCase, Step, StepKind } from './format.js';
import type { CaseContext, ScenarioDatabase, ScenarioHarness, StepResult } from './harness.js';

/** The feature each kind of step arrives with (`docs/ROADMAP.md`). */
export const STEPS_ARRIVE_WITH = {
  manual: 'manual entries arrive with S03',
  reversal: 'reversals arrive with S03',
  rate: 'rate steps arrive with S03, on the S02 rate table',
  event: 'Hub events arrive with S05',
  job: 'jobs arrive with S07',
} as const satisfies Record<StepKind, string>;

/** A case that did not do what its scenario states: every difference, one per line. */
export class ScenarioFailure extends Error {
  constructor(readonly differences: readonly string[]) {
    super(differences.map((difference) => `- ${difference}`).join('\n'));
    this.name = 'ScenarioFailure';
  }
}

type Run = (context: CaseContext) => Promise<StepResult>;

function executorFor(harness: ScenarioHarness, step: Step): Run | undefined {
  switch (step.kind) {
    case 'event': {
      const execute = harness.executors.event;
      return execute && ((context) => execute(context, step));
    }
    case 'manual': {
      const execute = harness.executors.manual;
      return execute && ((context) => execute(context, step));
    }
    case 'reversal': {
      const execute = harness.executors.reversal;
      return execute && ((context) => execute(context, step));
    }
    case 'job': {
      const execute = harness.executors.job;
      return execute && ((context) => execute(context, step));
    }
    case 'rate': {
      const execute = harness.executors.rate;
      return execute && ((context) => execute(context, step));
    }
  }
}

function describeStep(step: Step): string {
  switch (step.kind) {
    case 'event':
      return `event ${step.type} on ${step.accountingDate}`;
    case 'manual':
      return `manual entry "${step.description}" on ${step.accountingDate}`;
    case 'reversal':
      return `reversal of entry ${step.entry} on ${step.accountingDate}`;
    case 'job':
      return `job ${step.name} for ${step.period}`;
    case 'rate': {
      const { type, base, quote, rate, effectiveOn } = step.rate;
      const what = step.reason === null ? 'rate' : 'rate correction';
      return `${what} ${type} ${base}/${quote} ${rate} on ${effectiveOn}`;
    }
  }
}

function describeResult(result: StepResult | Outcome): string {
  return result.status === 'done' ? 'done' : `${result.status} ${result.reason}`;
}

function sameResult(result: StepResult, expected: StepResult | Outcome): boolean {
  if (result.status === 'done' || expected.status === 'done')
    return result.status === expected.status;
  return result.status === expected.status && result.reason === expected.reason;
}

/**
 * Runs one `Approved` case on the run's database and throws a `ScenarioFailure` listing every
 * difference. Before anything runs, every part the case needs must be in the harness: an approved
 * step with no executor fails the case, never skips it. Each step must be done, except the last when
 * the case states an `outcome`: then the last step must be held or refused with that reason. Then
 * the ledger must hold exactly the expected entries (`compareEntries`), the stated balances and
 * the stated open items, and each stated correction's answer must list exactly its entries.
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
  if (!harness.setUp || !harness.ledger || missing.length > 0) throw new ScenarioFailure(missing);

  const { company, rates, steps, expect } = scenarioCase;
  const companyId = await harness.setUp(database, company, rates);
  const context: CaseContext = { database, companyId, company };
  const differences: string[] = [];
  const corrections = new Map(expect.corrections.map((c) => [c.step, c.usedBy]));

  for (const [index, run] of runs.entries()) {
    const result = await run(context);
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
    const last = index === runs.length - 1;
    const expected: StepResult | Outcome = (last && expect.outcome) || { status: 'done' };
    if (!sameResult(result, expected)) {
      const step = steps[index] as Step;
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
  if (differences.length > 0) throw new ScenarioFailure(differences);
}
