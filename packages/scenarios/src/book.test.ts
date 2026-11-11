import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCase, parseScenario, readBook, ScenarioFormatError, yamlBlocks } from './book.js';
import { CASE, CORRECTION, INBOX, SYP_ONLY } from './test-fixtures.js';

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
      'event, manual, reversal, job, rate, retry, move, resolve, dismiss, recognise, split, revalue or block',
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
