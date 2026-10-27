import { describe, expect, it } from 'vitest';
import { parseCase } from './book.js';
import type { ScenarioCase } from './format.js';
import type {
  ObservedBalance,
  ObservedOpenItem,
  PostedEntry,
  ScenarioDatabase,
  ScenarioHarness,
  StepResult,
} from './harness.js';
import { runCase, ScenarioFailure } from './run.js';
import { CASE, CORRECTION } from './test-fixtures.js';

// The runner against a fake harness: what the S03, S05 and S07 parts will hand it, built here from
// the case itself so each test can break one thing. The book runs on a real database
// (test/scenario-book.test.ts).
const database = {} as ScenarioDatabase;

/** The expected entries as the ledger would hold them, each line list in reverse order. */
function asPosted(scenarioCase: ScenarioCase): PostedEntry[] {
  return scenarioCase.expect.entries.map((entry) => ({
    source: entry.source,
    date: entry.date,
    lines: [...entry.lines].reverse(),
    auditRows: 1,
  }));
}

function harness(
  posted: PostedEntry[],
  options: {
    results?: StepResult[];
    balance?: ObservedBalance;
    openItem?: ObservedOpenItem | null;
  } = {},
) {
  const calls: string[] = [];
  const results = [...(options.results ?? [])];
  const fake: ScenarioHarness = {
    setUp: async () => {
      calls.push('setUp');
      return 'company-1';
    },
    executors: {
      event: async (_, step) => {
        calls.push(step.type);
        return results.shift() ?? { status: 'done' };
      },
    },
    ledger: {
      entries: async () => posted,
      balance: async () => options.balance ?? { amount: null, book: 1200000n, parallel: 10000n },
      openItem: async () => (options.openItem === undefined ? INV_1 : options.openItem),
    },
  };
  return { fake, calls };
}

async function differences(work: Promise<void>): Promise<readonly string[]> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ScenarioFailure) return error.differences;
    throw error;
  }
  throw new Error('expected the case to fail');
}

const usdInvoice = parseCase(CASE);

const INV_1: ObservedOpenItem = {
  dims: { client: 'C1' },
  currency: 'USD',
  amount: 10000n,
  book: 1200000n,
  parallel: 10000n,
};

function withLine(entries: PostedEntry[], change: (entry: PostedEntry) => PostedEntry) {
  return entries.map((entry, index) => (index === 0 ? change(entry) : entry));
}

describe('runCase', () => {
  it('passes when the ledger holds exactly the expected entries, the lines in any order', async () => {
    const { fake, calls } = harness(asPosted(usdInvoice));
    await runCase(usdInvoice, fake, database);
    expect(calls).toEqual(['setUp', 'invoice.issued']);
  });

  it('fails an approved step with no executor before anything runs', async () => {
    const { fake, calls } = harness(asPosted(usdInvoice));
    const found = await differences(runCase(usdInvoice, { ...fake, executors: {} }, database));
    expect(found).toEqual([
      'step 1 (event invoice.issued on 2026-11-03): no executor for event steps; ' +
        'Hub events arrive with S05',
    ]);
    expect(calls).toEqual([]);
  });

  it('fails without a company setup or a ledger reader', async () => {
    const found = await differences(runCase(usdInvoice, { executors: {} }, database));
    expect(found).toHaveLength(3);
    expect(found[0]).toContain('No company setup');
    expect(found[1]).toContain('No ledger reader');
  });

  it('names a missing line and an extra one when an amount differs in one ledger', async () => {
    const posted = withLine(asPosted(usdInvoice), (entry) => ({
      ...entry,
      lines: entry.lines.map((line) =>
        line.account === '1210' ? { ...line, parallel: 10001n } : line,
      ),
    }));
    const { fake } = harness(posted);
    expect(await differences(runCase(usdInvoice, fake, database))).toEqual([
      'entry 1 (invoice.issued, 2026-11-03): missing line 1210 {client: C1} USD: ' +
        'amount 10000, book 1200000, parallel 10000',
      'entry 1 (invoice.issued, 2026-11-03): extra line 1210 {client: C1} USD: ' +
        'amount 10000, book 1200000, parallel 10001',
    ]);
  });

  it('fails a line with other dimensions, and an extra line', async () => {
    const posted = withLine(asPosted(usdInvoice), (entry) => ({
      ...entry,
      lines: [
        ...entry.lines.map((line) =>
          line.account === '4110' ? { ...line, dims: { client: 'C1' } } : line,
        ),
        { account: '5910', dims: {}, currency: 'SYP', amount: 0n, book: 0n, parallel: 0n },
      ],
    }));
    const { fake } = harness(posted);
    const found = await differences(runCase(usdInvoice, fake, database));
    expect(found).toHaveLength(3);
    expect(found[0]).toContain('missing line 4110 {client: C1, service: S1}');
    expect(found.slice(1).join('\n')).toContain('extra line 4110 {client: C1} USD');
    expect(found.slice(1).join('\n')).toContain('extra line 5910 SYP');
  });

  it('fails an entry posted twice, and an entry of another source or date', async () => {
    const [entry] = asPosted(usdInvoice) as [PostedEntry];
    const twice = harness([entry, entry]).fake;
    expect(await differences(runCase(usdInvoice, twice, database))).toEqual([
      expect.stringMatching(/^entry 2 \(invoice\.issued, 2026-11-03\): posted, not expected: /),
    ]);

    const other = harness([{ ...entry, source: 'manual', date: '2026-11-04' }]).fake;
    expect(await differences(runCase(usdInvoice, other, database))).toEqual([
      'entry 1: source manual, expected invoice.issued',
      'entry 1: date 2026-11-04, expected 2026-11-03',
    ]);
  });

  it('fails when an expected entry was not posted', async () => {
    const { fake } = harness([]);
    expect(await differences(runCase(usdInvoice, fake, database))).toEqual([
      'entry 1 (invoice.issued, 2026-11-03): not posted',
    ]);
  });

  it.each([0, 2])('fails a posting with %i audit rows', async (auditRows) => {
    const { fake } = harness(withLine(asPosted(usdInvoice), (entry) => ({ ...entry, auditRows })));
    expect(await differences(runCase(usdInvoice, fake, database))).toEqual([
      `entry 1 (invoice.issued, 2026-11-03): ${auditRows} audit rows, expected one`,
    ]);
  });

  it('fails a stated balance that differs', async () => {
    const balance = { amount: null, book: 1200000n, parallel: 0n };
    const { fake } = harness(asPosted(usdInvoice), { balance });
    expect(await differences(runCase(usdInvoice, fake, database))).toEqual([
      'balance of 1210: parallel 0, expected 10000',
    ]);
  });
});

describe('runCase with open items', () => {
  it('fails an open item the company does not have', async () => {
    const { fake } = harness(asPosted(usdInvoice), { openItem: null });
    expect(await differences(runCase(usdInvoice, fake, database))).toEqual([
      'open item INV-1 on 1210: not found',
    ]);
  });

  it.each([
    ['another remaining amount', { ...INV_1, book: 0n }, 'book 0, parallel 10000'],
    ['other dimensions', { ...INV_1, dims: { client: 'C2' } }, '1210 {client: C2}'],
  ])('fails an open item with %s', async (_, openItem, found) => {
    const { fake } = harness(asPosted(usdInvoice), { openItem });
    const [difference, ...rest] = await differences(runCase(usdInvoice, fake, database));
    expect(rest).toEqual([]);
    expect(difference).toMatch(/^open item INV-1: /);
    expect(difference).toContain(found);
    expect(difference).toContain(
      'expected 1210 {client: C1} USD: amount 10000, book 1200000, parallel 10000',
    );
  });
});

describe('runCase with an outcome', () => {
  const held = parseCase(
    CASE.replace('  entries:\n', '  outcome: { status: held, reason: PERIOD_CLOSED }\n  entries:\n')
      .replace(/ {2}entries:\n(?:(?: {4}| {6}| {8}).*\n)+/, '  entries: []\n')
      .replace(/ {2}balances:\n.*\n/, ''),
  );

  it('passes when the last step is held with the stated reason and nothing is posted', async () => {
    const { fake } = harness([], { results: [{ status: 'held', reason: 'PERIOD_CLOSED' }] });
    await runCase(held, fake, database);
  });

  it.each([
    [{ status: 'done' } as const, 'done, expected held PERIOD_CLOSED'],
    [
      { status: 'held', reason: 'RATE_MISSING' } as const,
      'held RATE_MISSING, expected held PERIOD_CLOSED',
    ],
    [
      { status: 'refused', reason: 'PERIOD_CLOSED' } as const,
      'refused PERIOD_CLOSED, expected held',
    ],
  ])('fails a last step that was %o', async (result, difference) => {
    const { fake } = harness([], { results: [result] });
    const found = await differences(runCase(held, fake, database));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(difference);
  });

  it('fails an earlier step that was held: only the last step has an outcome', async () => {
    const twoSteps = parseCase(
      CASE.replace(
        'steps:\n',
        'steps:\n  - event: rate.recorded\n    accounting_date: 2026-11-02\n    payload: {}\n',
      ),
    );
    const { fake } = harness(asPosted(twoSteps), {
      results: [{ status: 'held', reason: 'NO_MAPPING' }],
    });
    expect(await differences(runCase(twoSteps, fake, database))).toEqual([
      'step 1 (event rate.recorded on 2026-11-02): held NO_MAPPING, expected done',
    ]);
  });
});

describe('runCase with a rate correction', () => {
  const corrected = parseCase(CORRECTION);

  function correctionHarness(usedBy: readonly number[] | undefined) {
    const calls: string[] = [];
    const fake: ScenarioHarness = {
      setUp: async () => 'company-1',
      executors: {
        manual: async (_, step) => {
          calls.push(step.description);
          return { status: 'done' };
        },
        rate: async (_, step) => {
          calls.push(`${step.rate.rate} ${step.reason}`);
          return usedBy === undefined ? { status: 'done' } : { status: 'done', usedBy };
        },
        reversal: async (_, step) => {
          calls.push(`reversal of ${step.entry}`);
          return { status: 'done' };
        },
      },
      ledger: {
        entries: async () => asPosted(corrected),
        balance: async () => ({ amount: null, book: 0n, parallel: 0n }),
        openItem: async () => null,
      },
    };
    return { fake, calls };
  }

  it('passes when the answer lists exactly the stated entries, and runs every step in order', async () => {
    const { fake, calls } = correctionHarness([1]);
    await runCase(corrected, fake, database);
    expect(calls).toEqual(['an expense', '121.5000 Mistyped', 'reversal of 1']);
  });

  it.each([
    [[], 'lists entries [], expected [1]'],
    [undefined, 'lists entries [], expected [1]'],
    [[1, 2], 'lists entries [1, 2], expected [1]'],
  ])('fails an answer listing %o', async (usedBy, difference) => {
    const { fake } = correctionHarness(usedBy);
    expect(await differences(runCase(corrected, fake, database))).toEqual([
      `step 2 (rate correction bulletin USD/SYP 121.5000 on 2026-11-08): ${difference}`,
    ]);
  });

  it('names the reversal and rate steps that have no executor', async () => {
    const { fake } = correctionHarness([1]);
    const found = await differences(
      runCase(
        corrected,
        { ...fake, executors: { manual: async () => ({ status: 'done' }) } },
        database,
      ),
    );
    expect(found).toEqual([
      'step 2 (rate correction bulletin USD/SYP 121.5000 on 2026-11-08): no executor for rate ' +
        'steps; rate steps arrive with S03, on the S02 rate table',
      'step 3 (reversal of entry 1 on 2026-11-08): no executor for reversal steps; ' +
        'reversals arrive with S03',
    ]);
  });
});
