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
  retry: 'inbox actions arrive with S05',
  move: 'inbox actions arrive with S05',
  resolve: 'inbox actions arrive with S05',
  dismiss: 'inbox actions arrive with S05',
  recognise: 'recognising in the first open period arrives with S06',
  split: "splitting a cancelled project's remainder arrives with S06",
  revalue: 'the month-end revaluation arrives with S07',
  block: 'blocking an account in the book arrives with S07',
  close: 'closing a period arrives with S07',
  reopen: 'reopening a period arrives with S07',
  draft: "saving a draft in the book arrives with S07's checklist",
  discard: "discarding a draft in the book arrives with S07's checklist",
  service_department: "a manual service's department arrives with S09",
} as const satisfies Record<StepKind, string>;

/** A case that did not do what its scenario states: every difference, one per line. */
export class ScenarioFailure extends Error {
  constructor(readonly differences: readonly string[]) {
    super(differences.map((difference) => `- ${difference}`).join('\n'));
    this.name = 'ScenarioFailure';
  }
}

type Run = (context: CaseContext) => Promise<StepResult>;

/**
 * A dimension value a case names: its type's code and its own code (`client: C1`). `hub` marks a
 * value a manual step names before a Hub event of the case brings it: the setup makes it and links
 * it to the Hub ID the case's events use (S02 rule 11), as a client typed in Mizan and linked later.
 */
export type NamedValue = { readonly type: string; readonly code: string; readonly hub?: true };

/**
 * Every dimension value a case names, in the order first named: in its manual steps' lines, its
 * expected lines, balances and open items. The setup makes each one, so a case states its values by
 * code and never creates them in a step (S04); those Hub's events bring first are theirs (S05).
 */
export function namedDimensionValues(scenarioCase: ScenarioCase): NamedValue[] {
  const named = new Map<string, NamedValue>();
  const keyOf = (type: string, code: string) => JSON.stringify([type, code]);
  // The step at which a Hub event first brings each value.
  const fromHub = new Map<string, number>();
  for (const [index, step] of scenarioCase.steps.entries()) {
    for (const value of stepEventValues(step)) {
      const key = keyOf(value.type, value.code);
      if (!fromHub.has(key)) fromHub.set(key, index);
    }
  }
  const add = (dims: unknown, index: number | null) => {
    if (typeof dims !== 'object' || dims === null) return;
    for (const [type, code] of Object.entries(dims)) {
      if (typeof code !== 'string') continue;
      const key = keyOf(type, code);
      const hubAt = fromHub.get(key);
      if (named.has(key) || (hubAt !== undefined && (index === null || index > hubAt))) continue;
      named.set(key, { type, code, ...(hubAt !== undefined && { hub: true as const }) });
    }
  };
  for (const [index, step] of scenarioCase.steps.entries()) {
    if (step.kind === 'service_department') {
      add({ service: step.service, department: step.department }, index);
    }
    if (step.kind !== 'manual' && step.kind !== 'draft') continue;
    const lines = (step.payload as { lines?: unknown }).lines;
    if (Array.isArray(lines)) {
      for (const line of lines) add((line as { dims?: unknown }).dims, index);
    }
  }
  const { expect } = scenarioCase;
  for (const entry of expect.entries) for (const line of entry.lines) add(line.dims, null);
  for (const balance of expect.balances) add(balance.dims, null);
  for (const item of expect.openItems) add(item.dims, null);
  return [...named.values()];
}

/**
 * The values a case's Hub events bring by their references (S05 rule 23): Hub's events make them,
 * with the code the case names, so the setup leaves them out.
 */
export function eventValues(scenarioCase: ScenarioCase): NamedValue[] {
  return scenarioCase.steps.flatMap(stepEventValues);
}

/** The values one step brings from Hub: an event's references, none for any other step. */
function stepEventValues(step: Step): NamedValue[] {
  const values: NamedValue[] = [];
  const add = (type: string, code: unknown) => {
    if (typeof code === 'string') values.push({ type, code });
  };
  if (step.kind !== 'event') return values;
  const payload = step.payload as Record<string, unknown>;
  add('client', payload.client);
  add('department', payload.department);
  add('service', payload.old_service);
  add('service', payload.new_service);
  // A milestone's done names its service (S06 rule 11).
  add('service', payload.service);
  // A project's events name it as `project` (S06), an invoice or an expense as `contract`.
  const contract = (payload.contract ?? payload.project) as
    | { code?: unknown; client?: unknown }
    | undefined;
  if (contract !== undefined) {
    add('contract', contract.code);
    add('client', contract.client);
  }
  const lines = payload.lines;
  if (Array.isArray(lines)) {
    for (const line of lines) {
      // A service as `S1`, or with its department as `{ code: S1, department: design }` (S09).
      const service = (line as { service?: unknown }).service;
      if (typeof service === 'object' && service !== null) {
        const { code, department } = service as { code?: unknown; department?: unknown };
        add('service', code);
        add('department', department);
      } else add('service', service);
    }
  }
  return values;
}

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
    case 'retry': {
      const execute = harness.executors.retry;
      return execute && ((context) => execute(context, step));
    }
    case 'move': {
      const execute = harness.executors.move;
      return execute && ((context) => execute(context, step));
    }
    case 'resolve': {
      const execute = harness.executors.resolve;
      return execute && ((context) => execute(context, step));
    }
    case 'dismiss': {
      const execute = harness.executors.dismiss;
      return execute && ((context) => execute(context, step));
    }
    case 'recognise': {
      const execute = harness.executors.recognise;
      return execute && ((context) => execute(context, step));
    }
    case 'split': {
      const execute = harness.executors.split;
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
    case 'retry':
      return `retry of step ${step.step}`;
    case 'move':
      return `move of step ${step.step} to the next open period`;
    case 'resolve':
      return `resolution of step ${step.step} by entry ${step.entry}`;
    case 'dismiss':
      return `dismissal of step ${step.step}`;
    case 'recognise':
      return `recognition of step ${step.step} in the first open period`;
    case 'split':
      return `split of step ${step.step}'s remainder with ${step.revenueMinor} to revenue`;
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
