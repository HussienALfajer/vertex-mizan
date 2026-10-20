import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCase, parseScenario, readBook, ScenarioFormatError, yamlBlocks } from './book.js';
import { CASE, SYP_ONLY } from './test-fixtures.js';

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

  it.each([
    ['yml', fenced('```yml', '```'), 'fenced exactly'],
    ['YAML', fenced('```YAML', '```'), 'fenced exactly'],
    ['yaml with a title', fenced('```yaml case', '```'), 'fenced exactly'],
    ['an indented fence', fenced('  ```yaml', '  ```'), 'three backticks'],
    ['tildes', fenced('~~~yaml', '~~~'), 'three backticks'],
    ['four backticks', fenced('````yaml', '````'), 'three backticks'],
    ['a fence never closed', `\`\`\`yaml\n${body}`, 'never closed'],
  ])('refuses a case hidden by %s, beside a case read', (_, hidden, problem) => {
    const markdown = `${file('Status: Approved (owner, 2026-10-21)', SYP_ONLY)}\n${hidden}\n`;
    expect(problems(markdown).join('\n')).toContain(problem);
  });

  it('closes a fence as CommonMark does, so a later case is still read', () => {
    const markdown = ['```text', 'a ``` inside', '  ```', '', '```yaml', body, '```'];
    expect(yamlBlocks(markdown.join('\n'))).toEqual({
      blocks: [{ line: 5, source: body }],
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
      'event, manual or job',
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
