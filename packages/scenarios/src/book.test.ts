import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCase, parseScenario, readBook, ScenarioFormatError, yamlBlocks } from './book.js';
import { CASE, CORRECTION, SYP_ONLY } from './test-fixtures.js';

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
      'event, manual, reversal, job or rate',
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
    });
    expect(corrected.steps[2]).toEqual({
      kind: 'reversal',
      entry: 1,
      accountingDate: '2026-11-08',
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
  ] as const)('refuses %s', (_, [from, to], problem) => {
    expect(refusal(CORRECTION.replace(from, to))).toContain(problem);
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
