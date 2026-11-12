import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCase, parseScenario, readBook, ScenarioFormatError, yamlBlocks } from './book.js';
import { marginOf } from './report-format.js';
import { CASE, CORRECTION, INBOX, REPORTS, SYP_ONLY } from './test-fixtures.js';

function file(status: string, ...cases: string[]) {
  return [
    '# A rule',
    '',
    status,
    '',
    ...cases.flatMap((source) => ['```yaml', source.trim(), '```', '']),
  ].join('\n');
}

function problems(markdown: string): readonly string[] {
  try {
    parseScenario('docs/scenarios/receivables/a-rule.md', markdown);
  } catch (error) {
    if (error instanceof ScenarioFormatError) return error.problems;
    throw error;
  }
  throw new Error('expected the scenario to be refused');
}

/** A late invoice held `SERVICE_PERIOD_CLOSED`, recognised in the first open period (S06 rule 16). */
const RECOGNISE = `
case: a late part recognised in the first open period
company: { shape: syp, book: SYP, closed_periods: [2026-10], rate_policy: { book: bulletin } }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-05
    payload: { invoice: INV-1, client: C1, currency: SYP,
               lines: [{ amount: 62000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-10-20, cycle_end: 2026-11-19, service: S1 }] }
    outcome: { status: held, reason: SERVICE_PERIOD_CLOSED }
  - recognise: 1
    reason: "أُغلق تشرين الأول قبل وصول الفاتورة"
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-01
      lines:
        - { account: "1130", dims: { client: C1 }, currency: SYP, amount: 24000, book: 24000 }
        - { account: "4110", dims: { client: C1, service: S1 }, currency: SYP, amount: -24000, book: -24000 }
`;

/** A cancelled project's remainder split by the accountant (S06 rules 15–16). */
const SPLIT = `
case: a cancelled project's remainder split
company: { shape: syp, book: SYP, rate_policy: { book: bulletin } }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: SYP, lines: [{ amount: 30000, source: deposit, milestone: MS-1, service: S1 }] }
  - event: project.cancelled
    accounting_date: 2026-12-10
    payload: { project: { code: P1, kind: project, client: C1 }, client: C1, on: 2026-12-10 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: cancelled_project_remainder }
  - split: { step: 2, revenue: 10000 }
    reason: "ثلث الدفعة مستحق"
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "1120", dims: { client: C1 }, currency: SYP, amount: 30000, book: 30000 }
        - { account: "2120", dims: { client: C1 }, currency: SYP, amount: -30000, book: -30000 }
    - source: project.cancelled
      date: 2026-12-10
      lines:
        - { account: "2120", dims: { client: C1 }, currency: SYP, amount: 30000, book: 30000 }
        - { account: "4110", dims: { client: C1, service: S1 }, currency: SYP, amount: -10000, book: -10000 }
        - { account: "2110", dims: { client: C1 }, currency: SYP, amount: -20000, book: -20000 }
`;

/** A month-end revaluation of each ledger, after an account is blocked (S07 rules 10–18). */
const REVALUE = `
case: a blocked account revalued in both ledgers
company: { shape: syp-usd, book: SYP, parallel: USD, rate_policy: { book: bulletin, parallel: market } }
steps:
  - manual: an owner's deposit into the USD e-wallet
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "1116", currency: USD, amount: 10000 },
                       { account: "3130", currency: USD, amount: -10000 }] }
  - block: "1116"
    reason: "أوقف مزود المحفظة الحساب"
  - revalue: book
    period: 2026-11
  - revalue: parallel
    period: 2026-11
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "1116", currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
        - { account: "3130", currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        - { account: "1116", currency: USD, amount: 0, book: 50000, parallel: 0 }
        - { account: "4212", currency: SYP, amount: -50000, book: -50000, parallel: 0 }
`;

/** S10: Hub's snapshot and the records posted as the opening, then its whole reversal. */
const OPENING = `
case: an opening refused, posted and reversed
company: { shape: syp-usd, book: SYP, parallel: USD, books_start: 2026-10-01,
           rate_policy: { book: bulletin, parallel: market } }
steps:
  - opening: the opening
    snapshot:
      invoices:
        - { invoice: INV-1, client: C1, currency: USD, syp_per_usd: "117.0000", issued_on: 2026-09-10,
            total: 30000, outstanding: 30000, lines: [{ amount: 30000, source: extra_work, service: S1 }] }
      wallets:
        - { client: C1, balance: -12000 }
    records:
      lines:
        - { account: "3110", currency: SYP, amount: -3450000, parallel: -30000 }
      figures:
        - { slot: receivable, client: C1, currency: USD, amount: 30000 }
    outcome: { status: refused, reason: OPENING_CHECKS_FAILED, detail: "records_agree,rates" }
  - opening: the opening without Hub
    records:
      lines:
        - { account: "1111", currency: SYP, amount: 100, open_item: { ref: M-1 }, memo: a note }
  - reverse_opening: "Mistyped"
expect:
  entries:
    - source: opening
      date: 2026-10-01
      lines:
        - { account: "1121", dims: { client: C1 }, currency: USD, amount: 30000, book: 3450000, parallel: 30000 }
        - { account: "3110", currency: SYP, amount: -3450000, book: -3450000, parallel: -30000 }
`;

function refusal(source: string): string {
  return problems(file('Status: Proposed', source)).join('\n');
}

describe('the README', () => {
  it('its examples are cases in the format the runner reads', () => {
    const readme = readFileSync(
      new URL('../../../docs/scenarios/README.md', import.meta.url),
      'utf8',
    );
    expect(yamlBlocks(readme).problems).toEqual([]);
    const examples = yamlBlocks(readme.slice(readme.indexOf('\n## Examples'))).blocks;
    expect(examples).toHaveLength(2);
    for (const example of examples)
      expect(parseCase(example.source).expect.entries).toHaveLength(2);
  });
});

describe('the fences', () => {
  const body = CASE.trim();
  const fenced = (open: string, close = open) => `${open}\n${body}\n${close}`;

  const only = 'the only fence in a scenario file is ```yaml';
  it.each([
    ['no language', fenced('```', '```'), only],
    ['yml', fenced('```yml', '```'), only],
    ['YAML', fenced('```YAML', '```'), only],
    ['yaml with a title', fenced('```yaml case', '```'), only],
    ['a fence indented by two spaces', fenced('  ```yaml', '  ```'), only],
    [
      'a fence under a list item',
      `- a case:\n\n    \`\`\`yaml\n    ${body.replaceAll('\n', '\n    ')}\n    \`\`\``,
      only,
    ],
    ['a quoted fence', `> \`\`\`yaml\n> ${body.replaceAll('\n', '\n> ')}\n> \`\`\``, only],
    ['tildes', fenced('~~~yaml', '~~~'), only],
    ['four backticks', fenced('````yaml', '````'), only],
    ['an indented closing fence', fenced('```yaml', '  ```'), 'closes with ```'],
    ['a block never closed', `\`\`\`yaml\n${body}`, 'never closed'],
  ])('refuses a case hidden by %s, beside a case read', (_, hidden, problem) => {
    const markdown = `${file('Status: Approved (owner, 2026-10-21)', SYP_ONLY)}\n${hidden}\n`;
    expect(problems(markdown).join('\n')).toContain(problem);
  });

  it('reads each yaml block with the line its fence opens on', () => {
    const markdown = ['# A rule', '', '```yaml', body, '```', 'Prose with `` ``` `` inline.'];
    expect(yamlBlocks(markdown.join('\n'))).toEqual({
      blocks: [{ line: 3, source: body }],
      problems: [],
    });
  });
});

describe('a scenario file', () => {
  it('reads the title, an approval and every case', () => {
    const scenario = parseScenario(
      'docs/scenarios/receivables/a-rule.md',
      file('Status: Approved (owner, 2026-10-21)', CASE, SYP_ONLY),
    );
    expect(scenario.title).toBe('A rule');
    expect(scenario.status).toEqual({ status: 'approved', approvedOn: '2026-10-21' });
    expect(scenario.cases.map((c) => c.name)).toEqual(['USD invoice issued', 'SYP invoice issued']);
  });

  it('reads amounts as bigint minor units and the company as its ledgers', () => {
    const scenarioCase = parseCase(CASE);
    expect(scenarioCase.expect.entries[0]?.lines[0]).toEqual({
      account: '1210',
      dims: { client: 'C1' },
      currency: 'USD',
      amount: 10000n,
      book: 1200000n,
      parallel: 10000n,
    });
    expect(scenarioCase.company.ledgers).toEqual({
      book: {
        currency: 'SYP',
        ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
      },
      parallel: {
        currency: 'USD',
        ratePolicy: { rateType: 'market', acceptsTransactionRate: true },
      },
    });
    expect(scenarioCase.rates[0]).toMatchObject({ effectiveOn: '2026-11-03', source: 'manual' });
    expect(scenarioCase.steps[0]).toMatchObject({ kind: 'event', type: 'invoice.issued' });
    expect(parseCase(SYP_ONLY).expect.entries[0]?.lines[0]?.parallel).toBeNull();
  });

  it('reads Proposed', () => {
    const scenario = parseScenario('x.md', file('Status: Proposed', CASE));
    expect(scenario.status).toEqual({ status: 'proposed' });
  });

  it.each([
    ['no status', file('', CASE), 'Expected one status line, found 0'],
    ['two statuses', file('Status: Proposed\nStatus: Proposed', CASE), 'found 2'],
    ['an approval without the owner', file('Status: Approved (2026-10-21)', CASE), 'Expected'],
    ['an approval on no date', file('Status: Approved (owner, 2026-02-30)', CASE), 'not a date'],
    ['no case', file('Status: Proposed'), 'No case'],
    ['two cases of one name', file('Status: Proposed', CASE, CASE), 'Two cases are named'],
    ['no title', file('Status: Proposed', CASE).replace('# A rule', ''), 'No title'],
  ])('refuses %s', (_, markdown, problem) => {
    expect(problems(markdown).join('\n')).toContain(problem);
  });
});

describe('a case', () => {
  it.each([
    [
      'a decimal amount',
      CASE.replace('amount: 10000, book', 'amount: 100.5, book'),
      'whole minor units',
    ],
    ['an unquoted account', CASE.replace('"4110"', '4110'), 'account code in quotes'],
    ['an unquoted rate', CASE.replace('"120.0000"', '120'), 'rate as a decimal in quotes'],
    [
      'a repeated key',
      CASE.replace('type: bulletin }', 'type: bulletin, type: market }'),
      'unique',
    ],
    ['an unknown key', CASE.replace('case:', 'note: x\ncase:'), 'note'],
    ['an invalid date', CASE.replace('date: 2026-11-03\n', 'date: 2026-11-31\n'), 'date'],
    [
      'an entry out of balance in the book ledger',
      CASE.replace('book: -1200000', 'book: -1199999'),
      'out of balance by 1 in the book ledger',
    ],
    [
      'an entry out of balance in the parallel ledger',
      CASE.replace('parallel: -10000', 'parallel: -9999'),
      'out of balance by 1 in the parallel ledger',
    ],
    ['an entry of one line', SYP_ONLY.replace(/\n {8}- \{ account: "4110".*/, ''), '2'],
    [
      'a missing parallel amount',
      CASE.replace(', parallel: 10000 }\n        - {', ' }\n        - {'),
      'state the parallel amount',
    ],
    [
      'a parallel amount without a parallel ledger',
      SYP_ONLY.replace('book: 50000 }', 'book: 50000, parallel: 1 }'),
      'state no parallel amount',
    ],
    [
      'a balance without its parallel amount',
      CASE.replace(
        '{ account: "1210", book: 1200000, parallel: 10000 }',
        '{ account: "1210", book: 1200000 }',
      ),
      'state the parallel amount',
    ],
    [
      'a book currency other than the shape',
      CASE.replace('book: SYP', 'book: USD'),
      'books in SYP',
    ],
    [
      'a parallel ledger the shape has not',
      SYP_ONLY.replace('book: SYP,', 'book: SYP, parallel: USD,'),
      'no parallel',
    ],
    [
      'a parallel ledger without its rate policy',
      CASE.replace(', parallel: market, parallel_accepts_transaction_rate: true', ''),
      'come together',
    ],
    [
      'a bulletin policy that accepts a transaction rate',
      CASE.replace('parallel: market', 'parallel: bulletin'),
      'Only a market policy',
    ],
    ['a rate in one currency', CASE.replace('quote: SYP', 'quote: USD'), 'one currency in another'],
    [
      'an SYP rate before the new pound',
      CASE.replace('date: 2026-11-03,', 'date: 2025-12-31,'),
      'SYP rate dated before',
    ],
    [
      'a step of no kind',
      CASE.replace('  - event: invoice.issued', '  - what: invoice.issued'),
      'event, manual, reversal, job, rate, retry, move, resolve, dismiss, recognise, split, revalue, block, close, reopen, draft, discard, service_department, opening or reverse_opening',
    ],
    [
      'a step of two kinds',
      CASE.replace('accounting_date: 2026-11-03\n', 'accounting_date: 2026-11-03\n    job: x\n'),
      'job',
    ],
    ['no step', SYP_ONLY.replace(/steps:\n(?: {2}.*\n)+/, 'steps: []\n'), '1'],
    [
      'a job without its period',
      SYP_ONLY.replace(/steps:\n(?: {2}.*\n)+/, 'steps:\n  - job: close_period\n'),
      'period',
    ],
    [
      'a transaction amount without its currency',
      CASE.replace(
        '{ account: "1210", book: 1200000',
        '{ account: "1210", amount: 1, book: 1200000',
      ),
      'needs its currency',
    ],
    [
      'an unknown outcome',
      CASE.replace('  balances:', '  outcome: { status: lost, reason: X }\n  balances:'),
      'status',
    ],
    [
      'an outcome with a malformed detail',
      CASE.replace(
        '  balances:',
        '  outcome: { status: held, reason: NEEDS_DECISION, detail: Beyond Tolerance }\n  balances:',
      ),
      'detail code',
    ],
    [
      "the last step's outcome stated on the step and in expect",
      CASE.replace(
        '    payload: { invoice: INV-1,',
        '    outcome: { status: held, reason: NO_MAPPING }\n    payload: { invoice: INV-1,',
      ).replace('  balances:', '  outcome: { status: held, reason: NO_MAPPING }\n  balances:'),
      'stated twice',
    ],
    [
      'a third-currency case with no third currency',
      CASE.replace('shape: syp-usd', 'shape: third'),
      'third currency',
    ],
    [
      'a book-currency line whose book amount is not its transaction amount',
      SYP_ONLY.replace('amount: 50000, book: 50000', 'amount: 50000, book: 49000').replace(
        'amount: -50000, book: -50000',
        'amount: -50000, book: -49000',
      ),
      'In SYP, the book amount is the transaction amount',
    ],
    [
      'a parallel-currency line whose parallel amount is not its transaction amount',
      CASE.replace(
        'amount: 10000, book: 1200000, parallel: 10000 }\n        -',
        'amount: 10000, book: 1200000, parallel: 9000 }\n        -',
      ).replace('parallel: -10000', 'parallel: -9000'),
      'In USD, the parallel amount is the transaction amount',
    ],
    [
      'a balance in the book currency whose amounts differ',
      CASE.replace(
        '{ account: "1210", book: 1200000',
        '{ account: "1210", currency: SYP, amount: 1, book: 1200000',
      ),
      'In SYP, the book amount',
    ],
    [
      'an open item whose parallel amount is not its USD amount',
      CASE.replace(/book: 1200000, parallel: 10000 \}\n$/, 'book: 1200000, parallel: 1 }\n'),
      'In USD, the parallel amount',
    ],
    [
      'an open item without its parallel amount',
      CASE.replace(/book: 1200000, parallel: 10000 \}\n$/, 'book: 1200000 }\n'),
      'state the parallel amount',
    ],
    ['an open item stated twice', CASE.replace(/( {4}- \{ item: .*\n)/, '$1$1'), 'stated twice'],
    [
      'a decimal number in a payload',
      CASE.replace('{ invoice: INV-1,', '{ invoice: INV-1, rate: 122.5,'),
      'A decimal number',
    ],
  ])('refuses %s', (_, source, problem) => {
    expect(refusal(source)).toContain(problem);
  });

  it("reads a step's outcome, with its detail or none", () => {
    const held = parseCase(
      CASE.replace(
        '    payload: { invoice: INV-1,',
        '    outcome: { status: held, reason: NEEDS_DECISION, detail: amount_above_applied }\n' +
          '    payload: { invoice: INV-1,',
      ),
    );
    expect(held.steps[0]?.outcome).toEqual({
      status: 'held',
      reason: 'NEEDS_DECISION',
      detail: 'amount_above_applied',
    });
    expect(parseCase(CASE).steps[0]?.outcome).toBeNull();
  });

  it('reads the bulletin calendar, its default days off, rate and reversal steps and corrections', () => {
    const corrected = parseCase(CORRECTION);
    expect(corrected.company.calendar).toEqual({ daysOff: [5, 6], holidays: ['2026-11-09'] });
    expect(corrected.steps[1]).toEqual({
      kind: 'rate',
      rate: {
        effectiveOn: '2026-11-08',
        base: 'USD',
        quote: 'SYP',
        rate: '121.5000',
        type: 'bulletin',
        source: 'manual',
      },
      reason: 'Mistyped',
      outcome: null,
    });
    expect(corrected.steps[2]).toEqual({
      kind: 'reversal',
      entry: 1,
      accountingDate: '2026-11-08',
      outcome: null,
    });
    expect(corrected.expect.corrections).toEqual([{ step: 2, usedBy: [1] }]);
    const fridayOnly = CORRECTION.replace(
      'bulletin_holidays: [2026-11-09]',
      'bulletin_days_off: [5]',
    );
    expect(parseCase(fridayOnly).company.calendar).toEqual({ daysOff: [5], holidays: [] });
  });

  it.each([
    [
      'a day off that is no weekday',
      ['bulletin_holidays: [2026-11-09]', 'bulletin_days_off: [8]'],
      'from 1 to 7',
    ],
    [
      'a day off stated twice',
      ['bulletin_holidays: [2026-11-09]', 'bulletin_days_off: [5, 5]'],
      'stated twice',
    ],
    ['a holiday on no date', ['[2026-11-09]', '[2026-11-31]'], 'date'],
    ['a holiday stated twice', ['[2026-11-09]', '[2026-11-09, 2026-11-09]'], 'stated twice'],
    ['a rate step with an unknown key', ['reason: Mistyped', 'reason: Mistyped, note: x'], 'note'],
    [
      'a rate step in one currency',
      ['quote: SYP, rate: "121', 'quote: USD, rate: "121'],
      'one currency',
    ],
    ['a reversal of an entry not expected', ['reversal: 1', 'reversal: 3'], 'Entry 3 is not'],
    ['a reversal of entry 0', ['reversal: 1', 'reversal: 0'], 'from 1'],
    [
      'a correction of a step that is not a rate',
      ['{ step: 2,', '{ step: 1,'],
      'Step 1 is not a rate',
    ],
    ['a correction of a rate with no reason', [', reason: Mistyped', ''], 'Step 2 is not a rate'],
    ['a correction listing an entry not expected', ['used_by: [1]', 'used_by: [1, 5]'], 'Entry 5'],
    [
      'a correction stated twice',
      [
        '    - { step: 2, used_by: [1] }',
        '    - { step: 2, used_by: [1] }\n    - { step: 2, used_by: [] }',
      ],
      'stated twice',
    ],
    [
      'a correction of a step that states an outcome',
      [
        'reason: Mistyped }\n',
        'reason: Mistyped }\n    outcome: { status: refused, reason: RATE_UNCHANGED }\n',
      ],
      'Step 2 states an outcome',
    ],
  ] as const)('refuses %s', (_, [from, to], problem) => {
    expect(refusal(CORRECTION.replace(from, to))).toContain(problem);
  });

  it("reads the accountant's actions on held events (S05 rules 15–17)", () => {
    const { steps } = parseCase(INBOX);
    expect(steps.slice(1, 3)).toEqual([
      {
        kind: 'retry',
        step: 1,
        outcome: { status: 'held', reason: 'PERIOD_CLOSED', detail: null },
      },
      { kind: 'move', step: 1, reason: 'أُغلق تشرين الأول قبل وصول الفاتورة', outcome: null },
    ]);
    expect(steps[5]).toEqual({
      kind: 'resolve',
      step: 4,
      entry: 2,
      reason: 'الزيادة التزام للعميل',
      outcome: null,
    });
    expect(steps[7]).toEqual({
      kind: 'dismiss',
      step: 7,
      reason: 'سُجّلت في Hub خطأً',
      outcome: null,
    });
  });

  it('reads the recognition of a held late part in the first open period (S06 rule 16)', () => {
    const { steps } = parseCase(RECOGNISE);
    expect(steps[1]).toEqual({
      kind: 'recognise',
      step: 1,
      reason: 'أُغلق تشرين الأول قبل وصول الفاتورة',
      outcome: null,
    });
    expect(refusal(RECOGNISE.replace('recognise: 1', 'recognise: 2'))).toContain(
      'Step 2 is not an earlier event step',
    );
    expect(
      refusal(RECOGNISE.replace('    reason: "أُغلق تشرين الأول قبل وصول الفاتورة"\n', '')),
    ).toContain('reason');
  });

  it("reads the split of a cancelled project's remainder (S06 rules 15–16)", () => {
    const { steps } = parseCase(SPLIT);
    expect(steps[2]).toEqual({
      kind: 'split',
      step: 2,
      revenueMinor: 10000n,
      reason: 'ثلث الدفعة مستحق',
      outcome: null,
    });
    expect(refusal(SPLIT.replace('split: { step: 2,', 'split: { step: 3,'))).toContain(
      'Step 3 is not an earlier event step',
    );
    expect(refusal(SPLIT.replace('    reason: "ثلث الدفعة مستحق"\n', ''))).toContain('reason');
    expect(refusal(SPLIT.replace('revenue: 10000 }', 'revenue: 100.5 }'))).toContain(
      'whole minor units',
    );
    expect(refusal(SPLIT.replace('revenue: 10000 }', 'revenue: 10000, kind: x }'))).toContain(
      'kind',
    );
  });

  it('reads the month-end revaluation of a ledger and the blocking of an account (S07)', () => {
    const { steps } = parseCase(REVALUE);
    expect(steps.slice(1)).toEqual([
      { kind: 'block', account: '1116', reason: 'أوقف مزود المحفظة الحساب', outcome: null },
      { kind: 'revalue', ledger: 'book', period: '2026-11', outcome: null },
      { kind: 'revalue', ledger: 'parallel', period: '2026-11', outcome: null },
    ]);
    expect(refusal(REVALUE.replace('revalue: book', 'revalue: both'))).toContain(
      'book or parallel',
    );
    expect(
      refusal(
        REVALUE.replace(
          'period: 2026-11\n  - revalue: parallel',
          'period: 2026-13\n  - revalue: parallel',
        ),
      ),
    ).toContain('YYYY-MM');
    expect(refusal(REVALUE.replace('    reason: "أوقف مزود المحفظة الحساب"\n', ''))).toContain(
      'reason',
    );
    expect(refusal(REVALUE.replace('block: "1116"', 'block: 1116'))).toContain('account code');
    const sypOnly = REVALUE.replace(
      'company: { shape: syp-usd, book: SYP, parallel: USD, rate_policy: { book: bulletin, parallel: market } }',
      'company: { shape: syp, book: SYP, rate_policy: { book: bulletin } }',
    ).replace(/, parallel: -?\d+ \}/g, ' }');
    expect(refusal(sypOnly)).toContain('The company keeps no parallel ledger to revalue');
  });

  it('reads the close and the reopen of a period, each with its reason (S07)', () => {
    const closeAndReopen = REVALUE.replace(
      '  - revalue: parallel\n    period: 2026-11\n',
      '  - revalue: parallel\n    period: 2026-11\n' +
        '  - close: 2026-11\n    reason: "إقفال تشرين الثاني"\n' +
        '  - reopen: 2026-11\n    reason: "دفعة متأخرة"\n' +
        '  - close: 2026-11\n    reason: "إعادة الإقفال"\n' +
        '    outcome: { status: refused, reason: CHECKLIST_FAILED, detail: revaluation_current }\n',
    );
    const { steps } = parseCase(closeAndReopen);
    expect(steps.slice(4)).toEqual([
      { kind: 'close', period: '2026-11', reason: 'إقفال تشرين الثاني', outcome: null },
      { kind: 'reopen', period: '2026-11', reason: 'دفعة متأخرة', outcome: null },
      {
        kind: 'close',
        period: '2026-11',
        reason: 'إعادة الإقفال',
        outcome: { status: 'refused', reason: 'CHECKLIST_FAILED', detail: 'revaluation_current' },
      },
    ]);
    expect(refusal(closeAndReopen.replace('close: 2026-11', 'close: 2026-13'))).toContain(
      'YYYY-MM',
    );
    expect(refusal(closeAndReopen.replace('    reason: "دفعة متأخرة"\n', ''))).toContain('reason');
  });

  it('reads a draft and its discard, and a refusal naming several items or a month (S03, S07)', () => {
    const withDraft = REVALUE.replace(
      '  - revalue: parallel\n    period: 2026-11\n',
      '  - revalue: parallel\n    period: 2026-11\n' +
        '  - draft: a subscription not yet paid\n    accounting_date: 2026-11-25\n' +
        '    payload: { lines: [{ account: "5314", currency: USD, amount: 5000 },\n' +
        '                       { account: "1116", currency: USD, amount: -5000 }] }\n' +
        '  - close: 2026-11\n    reason: "إقفال تشرين الثاني"\n' +
        '    outcome: { status: refused, reason: CHECKLIST_FAILED,\n' +
        '               detail: "no_drafts,revaluation_current" }\n' +
        '  - discard: 5\n    reason: "أُلغي الاشتراك"\n' +
        '  - close: 2026-11\n    reason: "إقفال تشرين الثاني"\n' +
        '    outcome: { status: refused, reason: PERIOD_ORDER, detail: "period:2026-10" }\n',
    );
    const { steps } = parseCase(withDraft);
    expect(steps.slice(4)).toEqual([
      {
        kind: 'draft',
        description: 'a subscription not yet paid',
        accountingDate: '2026-11-25',
        payload: {
          lines: [
            { account: '5314', currency: 'USD', amount: 5000n },
            { account: '1116', currency: 'USD', amount: -5000n },
          ],
        },
        outcome: null,
      },
      {
        kind: 'close',
        period: '2026-11',
        reason: 'إقفال تشرين الثاني',
        outcome: {
          status: 'refused',
          reason: 'CHECKLIST_FAILED',
          detail: 'no_drafts,revaluation_current',
        },
      },
      { kind: 'discard', step: 5, reason: 'أُلغي الاشتراك', outcome: null },
      {
        kind: 'close',
        period: '2026-11',
        reason: 'إقفال تشرين الثاني',
        outcome: { status: 'refused', reason: 'PERIOD_ORDER', detail: 'period:2026-10' },
      },
    ]);
    expect(refusal(withDraft.replace('discard: 5', 'discard: 4'))).toContain(
      'Step 4 is not an earlier draft step',
    );
    expect(refusal(withDraft.replace('discard: 5', 'discard: 7'))).toContain(
      'Step 7 is not an earlier draft step',
    );
    expect(refusal(withDraft.replace('no_drafts,revaluation_current', 'no_drafts,'))).toContain(
      'Expected a detail code',
    );
    expect(refusal(withDraft.replace('    reason: "أُلغي الاشتراك"\n', ''))).toContain('reason');
  });

  it.each([
    ['a retry of a later step', ['retry: 1', 'retry: 4'], 'Step 4 is not an earlier event step'],
    ['a move of a step that is no event', ['move: 1', 'move: 2'], 'Step 2 is not an earlier'],
    ['a move with no reason', ['    reason: "أُغلق تشرين الأول قبل وصول الفاتورة"\n', ''], 'reason'],
    ['a resolve of no event', ['{ step: 4, entry: 2 }', '{ step: 5, entry: 2 }'], 'Step 5 is not'],
    [
      'a resolve by an entry not expected',
      ['{ step: 4, entry: 2 }', '{ step: 4, entry: 3 }'],
      'Entry 3 is not',
    ],
    ['a resolve with no entry', ['{ step: 4, entry: 2 }', '{ step: 4 }'], 'entry'],
    ['a dismissal of the step itself', ['dismiss: 7', 'dismiss: 8'], 'Step 8 is not an earlier'],
    ['a dismissal with a blank reason', ['reason: "سُجّلت في Hub خطأً"', 'reason: " "'], 'reason'],
  ] as const)('refuses %s', (_, [from, to], problem) => {
    expect(refusal(INBOX.replace(from, to))).toContain(problem);
  });

  const TRY_CASH =
    '{ code: "111007", name: "الصندوق — ليرة تركية", currency: TRY, monetary: true, statement_line: bs.cash }';
  const withAccounts = (...accounts: string[]) =>
    SYP_ONLY.replace(
      'company: { shape: syp,',
      `company: { template: service-agency, accounts: [${accounts.join(', ')}], shape: syp,`,
    );

  it('reads the accounts a case adds to its template', () => {
    expect(parseCase(withAccounts(TRY_CASH)).company.accounts).toEqual([
      {
        code: '111007',
        name: 'الصندوق — ليرة تركية',
        nameLatin: null,
        statementLine: 'bs.cash',
        currency: 'TRY',
        isMonetary: true,
      },
    ]);
    expect(parseCase(SYP_ONLY).company.accounts).toEqual([]);
  });

  it.each([
    [
      'an account added with no template',
      withAccounts(TRY_CASH).replace('template: service-agency, ', ''),
      'known chart template',
    ],
    ['an account added twice', withAccounts(TRY_CASH, TRY_CASH), 'added twice'],
    [
      'an account already in the template',
      withAccounts(TRY_CASH.replace('111007', '111004')),
      'already in the service-agency template',
    ],
    ['a header added', withAccounts(TRY_CASH.replace('"111007"', '"119"')), 'postable'],
    [
      'an account under no header of the template',
      withAccounts(TRY_CASH.replace('111007', '119001')),
      'no header 119',
    ],
    [
      'a statement line of another class',
      withAccounts(TRY_CASH.replace('bs.cash', 'is.fx_differences')),
      'does not fit account 111007',
    ],
    ['an account with an unknown key', withAccounts(TRY_CASH.replace('monetary', 'cash')), 'cash'],
  ])('refuses %s', (_, source, problem) => {
    expect(refusal(source)).toContain(problem);
  });

  it("reads a company's contracts, a manual service's department and every report (S09)", () => {
    const reports = parseCase(REPORTS);
    expect(reports.company.contracts).toEqual([{ code: 'P1', kind: 'project', client: 'C1' }]);
    expect(reports.steps[0]).toEqual({
      kind: 'service_department',
      service: 'S1',
      department: 'design',
      effectiveFrom: '2026-11-01',
      reason: 'خدمة يدوية يقدمها قسم التصميم',
      outcome: null,
    });
    expect(reports.expect.reports.map((report) => report.report)).toEqual([
      'trial_balance',
      'income_statement',
      'balance_sheet',
      'profitability',
      'account_statement',
      'journal_book',
    ]);
    expect(reports.expect.reports[0]).toMatchObject({
      params: { from: '2026-11-01', to: '2026-11-30', ledger: 'book', level: 4 },
      marks: ['period_open'],
      compareMarks: null,
      totals: { debits: 50000n, closingCredit: 50000n },
    });
    expect(reports.expect.reports[3]).toMatchObject({
      rows: [{ value: 'design', revenue: 50000n, directCosts: 0n, margin: '100.0' }],
    });
    expect(reports.expect.reports[5]).toMatchObject({
      params: { fiscalYear: 2026, from: '2026-11', to: '2026-11', official: false },
      pages: [{ page: 1, entries: [1], broughtForward: { debits: 0n, credits: 0n } }],
    });
    expect(parseCase(SYP_ONLY).expect.reports).toEqual([]);
  });

  it.each([
    ['a contract with no client', ['kind: project, client: C1', 'kind: project'], 'client'],
    ['a department with no date', [', effective_from: 2026-11-01', ''], 'effective_from'],
    ['an unknown report', ['report: journal_book', 'report: cash_flow'], 'Expected a report'],
    [
      'an unknown mark',
      ['marks: [period_open]\n      rows', 'marks: [draft]\n      rows'],
      'period_open',
    ],
    [
      'a parallel ledger the company lacks',
      ['ledger: book, level: 4', 'ledger: parallel, level: 4'],
      'no parallel ledger to report',
    ],
    [
      'a trial balance whose pairs differ',
      ['debits: 50000, credits: 50000,\n', 'debits: 50000, credits: 50001,\n'],
      'debits and credits differ',
    ],
    [
      'a row whose closing balance is not its movements',
      ['debits: 0, credits: 50000, closing: -50000', 'debits: 0, credits: 50000, closing: -5000'],
      'opening balance plus debits less credits',
    ],
    [
      'totals the rows do not add up to',
      [
        'closing_debit: 50000, closing_credit: 50000',
        'closing_debit: 60000, closing_credit: 60000',
      ],
      'The rows add up to 50000 for closingDebit',
    ],
    [
      'a subtotal its lines do not give',
      ['profit_before_tax: 50000, profit: 50000', 'profit_before_tax: 50000, profit: 40000'],
      'The lines give 50000 for profit',
    ],
    [
      'a line outside the catalogue',
      ['line: is.revenue', 'line: is.sales'],
      'statement-line catalogue',
    ],
    [
      'a comparative figure with no comparative',
      [
        'marks: [period_open]\n      lines: [{ line: is.revenue',
        'marks: [period_open]\n      compare_marks: []\n      lines: [{ line: is.revenue',
      ],
      'compare_marks needs a comparative',
    ],
    [
      'a balance-sheet line that is not its parts',
      ['amount: 50000,\n                parts', 'amount: 40000,\n                parts'],
      'The parts add up to 50000',
    ],
    [
      'a balance sheet that does not balance',
      ['assets: 50000, liabilities: 0', 'assets: 60000, liabilities: 0'],
      'Assets equal liabilities and equity',
    ],
    [
      'a margin not rounded half away from zero',
      ['contribution: 50000, margin: "100.0" }]', 'contribution: 50000, margin: "99.9" }]'],
      'The margin is 100.0',
    ],
    [
      'a contribution that is not revenue less costs',
      [
        'rows: [{ value: design, revenue: 50000, direct_costs: 0, contribution: 50000',
        'rows: [{ value: design, revenue: 50000, direct_costs: 0, contribution: 40000',
      ],
      'The contribution is 50000',
    ],
    [
      'a running balance that does not run',
      ['amount: 50000, balance: 50000,', 'amount: 50000, balance: 5000,'],
      'The running balance is 50000',
    ],
    [
      'a page whose cumulative totals do not carry',
      [
        'cumulative: { debits: 50000, credits: 50000 }',
        'cumulative: { debits: 5000, credits: 5000 }',
      ],
      'brought forward plus the page',
    ],
    [
      'a page naming an entry not expected',
      ['entries: [1]', 'entries: [2]'],
      'Entry 2 is not an expected entry',
    ],
    [
      'a month outside the fiscal year',
      ['fiscal_year: 2026', 'fiscal_year: 2027'],
      'not in the fiscal year 2027',
    ],
  ] as const)('refuses %s', (_, [from, to], problem) => {
    expect(REPORTS).toContain(from);
    expect(refusal(REPORTS.replace(from, to))).toContain(problem);
  });

  // A second invoice back-dated before the first (ADR 0008 allows it in an open month).
  const backDated = (pages: string) =>
    REPORTS.replace(
      'expect:\n',
      '  - manual: a back-dated SYP invoice\n    accounting_date: 2026-11-02\n' +
        '    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: SYP, amount: 50000, open_item: { ref: M-2 } },\n' +
        '                       { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -50000 }] }\n' +
        'expect:\n',
    )
      .replace(
        '  reports:\n',
        '    - source: manual\n      date: 2026-11-02\n      lines:\n' +
          '        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 50000, book: 50000 }\n' +
          '        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -50000, book: -50000 }\n' +
          '  reports:\n',
      )
      .replace(/ {4}- report: account_statement[\s\S]*?(?= {4}- report: journal_book)/, '')
      .replace(
        / {4}- report: journal_book[\s\S]*$/,
        `    - report: journal_book\n      params: { fiscal_year: 2026, from: 2026-11, to: 2026-11 }\n      marks: [period_open]\n      pages:\n${pages}`,
      );
  const page = (number: number, entries: string, amount: number, before: number) =>
    `        - { page: ${number}, entries: [${entries}], debits: ${amount}, credits: ${amount},\n` +
    `            brought_forward: { debits: ${before}, credits: ${before} }, cumulative: { debits: ${before + amount}, credits: ${before + amount} } }\n`;

  it('reads the journal book in (entry_date, number) order, with an entry split across pages (S09 rules 26, 27)', () => {
    const inDateOrder = parseCase(backDated(page(1, '2, 1', 100000, 0)));
    expect(inDateOrder.expect.reports.at(-1)).toMatchObject({ pages: [{ entries: [2, 1] }] });
    const split = parseCase(backDated(page(1, '2, 1', 80000, 0) + page(2, '1', 20000, 80000)));
    expect(split.expect.reports.at(-1)).toMatchObject({
      pages: [{ entries: [2, 1] }, { entries: [1] }],
    });
    expect(refusal(backDated(page(1, '1, 2', 100000, 0)))).toContain(
      "The journal book's entries are in (entry_date, number) order",
    );
    expect(
      refusal(
        backDated(page(1, '2', 50000, 0) + page(2, '1', 50000, 50000) + page(3, '2', 0, 100000)),
      ),
    ).toContain('Entry 2 is on two pages without continuing');
  });

  it('reads profitability net of a void: negative revenue and costs (S09 edge case 12)', () => {
    const voided = REPORTS.replace(
      'rows: [{ value: design, revenue: 50000, direct_costs: 0, contribution: 50000, margin: "100.0" }]\n      totals: { revenue: 50000, direct_costs: 0, contribution: 50000, margin: "100.0" }',
      'rows: [{ value: design, revenue: -50000, direct_costs: -10000, contribution: -40000, margin: "80.0" }]\n      totals: { revenue: -50000, direct_costs: -10000, contribution: -40000, margin: "80.0" }',
    );
    expect(voided).not.toBe(REPORTS);
    expect(parseCase(voided).expect.reports[3]).toMatchObject({
      rows: [{ value: 'design', revenue: -50000n, directCosts: -10000n, contribution: -40000n }],
    });
  });

  it('gives the margin with one decimal, half away from zero, and none without revenue (S09 rule 21)', () => {
    expect(marginOf(80000n, 55000n)).toBe('68.8');
    expect(marginOf(270000n, 215000n)).toBe('79.6');
    expect(marginOf(80000n, -55000n)).toBe('-68.8');
    expect(marginOf(3n, 1n)).toBe('33.3');
    expect(marginOf(-50000n, -40000n)).toBe('80.0');
    expect(marginOf(-80000n, -55000n)).toBe('68.8');
    expect(marginOf(-80000n, 55000n)).toBe('-68.8');
    expect(marginOf(0n, -55000n)).toBeNull();
  });

  it("reads the books start, the opening's snapshot, lines and figures, and its reversal (S10)", () => {
    const { company, steps } = parseCase(OPENING);
    expect(company.booksStart).toBe('2026-10-01');
    expect(steps[0]).toEqual({
      kind: 'opening',
      description: 'the opening',
      snapshot: {
        invoices: [
          {
            invoice: 'INV-1',
            client: 'C1',
            currency: 'USD',
            syp_per_usd: '117.0000',
            issued_on: '2026-09-10',
            total: 30000n,
            outstanding: 30000n,
            lines: [{ amount: 30000n, source: 'extra_work', service: 'S1' }],
          },
        ],
        credits: [],
        milestones: [],
        wallets: [{ client: 'C1', balance: -12000n }],
      },
      lines: [
        {
          account: '3110',
          dims: {},
          currency: 'SYP',
          amount: -3450000n,
          book: null,
          parallel: -30000n,
          openItem: null,
          memo: null,
        },
      ],
      figures: [{ slot: 'receivable', client: 'C1', currency: 'USD', amount: 30000n }],
      outcome: {
        status: 'refused',
        reason: 'OPENING_CHECKS_FAILED',
        detail: 'records_agree,rates',
      },
    });
    expect(steps[1]).toMatchObject({
      kind: 'opening',
      snapshot: null,
      lines: [{ account: '1111', openItem: { ref: 'M-1', due: null }, memo: 'a note' }],
      figures: [],
    });
    expect(steps[2]).toEqual({ kind: 'reverse_opening', reason: 'Mistyped', outcome: null });

    expect(
      refusal(OPENING.replace('books_start: 2026-10-01', 'books_start: 2026-10-02')),
    ).toContain('first day of a month');
    expect(refusal(OPENING.replace(' books_start: 2026-10-01,', ''))).toContain(
      "needs the company's books_start",
    );
    const withoutOpening = OPENING.replace(
      / {2}- opening: the opening\n[\s\S]*?(?= {2}- reverse_opening)/,
      '',
    );
    expect(refusal(withoutOpening)).toContain('posts nothing without an opening step');
    expect(
      refusal(
        OPENING.replace(
          'amount: -3450000, parallel: -30000 }',
          'amount: -3450000, book: -3450000, parallel: -30000 }',
        ),
      ),
    ).toContain("the book amount is the line's amount");
    expect(refusal(OPENING.replace('slot: receivable', 'slot: contract_asset'))).toContain(
      'ad_funds',
    );
    expect(
      refusal(
        OPENING.replace(
          '        - { slot: receivable, client: C1, currency: USD, amount: 30000 }\n',
          '        - { slot: receivable, client: C1, currency: USD, amount: 30000 }\n'.repeat(2),
        ),
      ),
    ).toContain('A figure is stated twice');
    expect(refusal(OPENING.replace('balance: -12000 }', 'balance: -120.5 }'))).toContain(
      'whole minor units',
    );
    expect(refusal(OPENING.replace('total: 30000', 'total: 300.5'))).toContain('A decimal number');
    expect(
      refusal(OPENING.replace('reverse_opening: "Mistyped"', 'reverse_opening: ""')),
    ).toContain('reverse_opening');
  });

  it('accepts a third-currency case with a line in TRY', () => {
    const third = CASE.replace('shape: syp-usd', 'shape: third')
      .replaceAll('currency: USD, amount: 10000', 'currency: TRY, amount: 43000')
      .replaceAll('currency: USD, amount: -10000', 'currency: TRY, amount: -43000');
    expect(parseCase(third).company.shape).toBe('third');
  });
});

describe('the book', () => {
  let root = '';
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function book(files: Record<string, string>) {
    root = mkdtempSync(join(tmpdir(), 'mizan-book-'));
    for (const [name, content] of Object.entries(files)) {
      const path = join(root, 'docs', 'scenarios', ...name.split('/'));
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, content);
    }
    return readBook(root);
  }

  it('reads every <area>/<rule>.md in path order and leaves the README out', () => {
    const result = book({
      'README.md': '# Scenario book',
      'revenue/b-rule.md': file('Status: Proposed', CASE),
      'receivables/a-rule.md': file('Status: Approved (owner, 2026-10-21)', CASE),
    });
    expect(result.errors).toEqual([]);
    expect(result.files.map((f) => f.path)).toEqual([
      'docs/scenarios/receivables/a-rule.md',
      'docs/scenarios/revenue/b-rule.md',
    ]);
  });

  it('reports a file outside an area, deeper than one, not named in kebab-case or not Markdown', () => {
    const result = book({
      'a-rule.md': file('Status: Proposed', CASE),
      'sales/a-rule.md': file('Status: Proposed', CASE),
      'revenue/deeper/a-rule.md': file('Status: Proposed', CASE),
      'revenue/A_Rule.md': file('Status: Proposed', CASE),
      'revenue/a-rule.yaml': CASE,
      'revenue/a-rule.MD': file('Status: Proposed', CASE),
    });
    expect(result.files).toEqual([]);
    expect(result.errors).toHaveLength(6);
    for (const error of result.errors)
      expect(error).toContain('expected docs/scenarios/<area>/<rule>.md');
  });

  it('reports every broken file with its problems', () => {
    const result = book({
      'revenue/a-rule.md': file('Status: Draft', CASE.replace('"4110"', '4110')),
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('docs/scenarios/revenue/a-rule.md');
    expect(result.errors[0]).toContain('Expected "Status: Proposed"');
    expect(result.errors[0]).toContain('The case at line 5');
  });
});
