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
import { eventValues, namedDimensionValues, runCase, ScenarioFailure } from './run.js';
import { CASE, CORRECTION, INBOX, REPORTS } from './test-fixtures.js';

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

  it('names the inbox actions that have no executor (S05)', async () => {
    const inbox = parseCase(INBOX);
    const { fake } = harness([]);
    const done = async () => ({ status: 'done' as const });
    const found = await differences(
      runCase(inbox, { ...fake, executors: { event: done, manual: done } }, database),
    );
    expect(found).toEqual([
      'step 2 (retry of step 1): no executor for retry steps; inbox actions arrive with S05',
      'step 3 (move of step 1 to the next open period): no executor for move steps; ' +
        'inbox actions arrive with S05',
      'step 6 (resolution of step 4 by entry 2): no executor for resolve steps; ' +
        'inbox actions arrive with S05',
      'step 8 (dismissal of step 7): no executor for dismiss steps; inbox actions arrive with S05',
    ]);
  });

  it('fails a case stating reports without a report reader, and a department step without its executor (S09)', async () => {
    const { fake } = harness([]);
    const done = async () => ({ status: 'done' as const });
    const found = await differences(
      runCase(parseCase(REPORTS), { ...fake, executors: { manual: done } }, database),
    );
    expect(found).toEqual([
      'step 1 (department design of service S1 from 2026-11-01): no executor for ' +
        "service_department steps; a manual service's department arrives with S09",
      'No report reader is registered (packages/scenarios/src/harness.ts); reports arrive with S09',
    ]);
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

  it('fails an earlier step that was held when it states no outcome', async () => {
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

describe('runCase with an outcome on a step', () => {
  // A payment held at receipt, freed by the invoice that follows it: its entry posts after the
  // invoice's, so the ledger holds both and the first step answered held (S05 rule 11).
  const freed = parseCase(
    CASE.replace(
      'steps:\n',
      'steps:\n  - event: payment.recorded\n    accounting_date: 2026-11-03\n' +
        '    payload: { invoice: INV-1 }\n' +
        '    outcome: { status: held, reason: UNKNOWN_REFERENCE }\n',
    ),
  );

  it('passes when the step is held with the stated reason and the later steps are done', async () => {
    const { fake, calls } = harness(asPosted(freed), {
      results: [{ status: 'held', reason: 'UNKNOWN_REFERENCE' }, { status: 'done' }],
    });
    await runCase(freed, fake, database);
    expect(calls).toEqual(['setUp', 'payment.recorded', 'invoice.issued']);
  });

  it('fails the step when it was done instead', async () => {
    const { fake } = harness(asPosted(freed), {
      results: [{ status: 'done' }, { status: 'done' }],
    });
    expect(await differences(runCase(freed, fake, database))).toEqual([
      'step 1 (event payment.recorded on 2026-11-03): done, expected held UNKNOWN_REFERENCE',
    ]);
  });

  const decided = parseCase(
    CASE.replace(
      '    payload: { invoice: INV-1,',
      '    outcome: { status: held, reason: NEEDS_DECISION, detail: amount_above_applied }\n' +
        '    payload: { invoice: INV-1,',
    )
      .replace(/ {2}entries:\n(?:(?: {4}| {6}| {8}).*\n)+/, '  entries: []\n')
      .replace(/ {2}balances:\n.*\n/, '')
      .replace(/ {2}open_items:\n.*\n/, ''),
  );

  it('compares a stated detail', async () => {
    const same = harness([], {
      results: [{ status: 'held', reason: 'NEEDS_DECISION', detail: 'amount_above_applied' }],
    });
    await runCase(decided, same.fake, database);
    const other = harness([], {
      results: [{ status: 'held', reason: 'NEEDS_DECISION', detail: 'payment_exceeds_open' }],
    });
    expect(await differences(runCase(decided, other.fake, database))).toEqual([
      'step 1 (event invoice.issued on 2026-11-03): held NEEDS_DECISION (payment_exceeds_open), ' +
        'expected held NEEDS_DECISION (amount_above_applied)',
    ]);
  });

  it('does not compare a detail the case does not state', async () => {
    const reasonOnly = parseCase(
      CASE.replace(
        '    payload: { invoice: INV-1,',
        '    outcome: { status: held, reason: NEEDS_DECISION }\n    payload: { invoice: INV-1,',
      )
        .replace(/ {2}entries:\n(?:(?: {4}| {6}| {8}).*\n)+/, '  entries: []\n')
        .replace(/ {2}balances:\n.*\n/, '')
        .replace(/ {2}open_items:\n.*\n/, ''),
    );
    const { fake } = harness([], {
      results: [{ status: 'held', reason: 'NEEDS_DECISION', detail: 'payment_exceeds_open' }],
    });
    await runCase(reasonOnly, fake, database);
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

describe('namedDimensionValues (S04)', () => {
  it('lists each value a case names once, from its manual lines and what it expects', () => {
    const named = parseCase(`
case: a receipt on an item
company: { shape: syp, book: SYP, rate_policy: { book: bulletin } }
steps:
  - manual: an invoice
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C2 }, currency: SYP, amount: 100,
                         open_item: { ref: M-1 } },
                       { account: "411001", dims: { client: C2, service: S9 }, currency: SYP, amount: -100 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C2 }, currency: SYP, amount: 100, book: 100 }
        - { account: "411001", dims: { client: C2, service: S9 }, currency: SYP, amount: -100, book: -100 }
  balances:
    - { account: "213001", dims: { client: C3 }, book: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C2, project: P1 }, currency: SYP, amount: 100, book: 100 }
`);
    expect(namedDimensionValues(named)).toEqual([
      { type: 'client', code: 'C2' },
      { type: 'service', code: 'S9' },
      { type: 'client', code: 'C3' },
      { type: 'project', code: 'P1' },
    ]);
    expect(namedDimensionValues(parseCase(CORRECTION))).toEqual([]);
  });

  it('leaves out the values a Hub event brings, which the event makes by its Hub id (S05 rule 23)', () => {
    const named = parseCase(`
case: an invoice from Hub with its contract
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: SYP, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 100, source: extra_work, service: S1 }] }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 100, book: 100 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: SYP, amount: -100, book: -100 }
  balances:
    - { account: "411001", dims: { service: S2 }, book: 0 }
`);
    expect(eventValues(named)).toEqual([
      { type: 'client', code: 'C1' },
      { type: 'contract', code: 'R1' },
      { type: 'client', code: 'C1' },
      { type: 'service', code: 'S1' },
    ]);
    expect(namedDimensionValues(named)).toEqual([{ type: 'service', code: 'S2' }]);
  });

  it('makes and links a value a manual step names before a Hub event brings it (S02 rule 11)', () => {
    const named = parseCase(`
case: a manual invoice, then a deposit from Hub for the same client
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
steps:
  - manual: an invoice
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: SYP, amount: 100,
                         open_item: { ref: M-1 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -100 }] }
  - event: ad_wallet.deposited
    accounting_date: 2026-11-04
    payload: { entry: W-1, client: C1, entered_on: 2026-11-04, method: bank_transfer,
               currency: SYP, amount: 50, syp_per_usd: "124.0000", usd_amount: 1 }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 100, book: 100 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -100, book: -100 }
    - source: ad_wallet.deposited
      date: 2026-11-04
      lines:
        - { account: "111003", currency: SYP, amount: 50, book: 50 }
        - { account: "213001", dims: { client: C1 }, currency: SYP, amount: -50, book: -50 }
`);
    expect(namedDimensionValues(named)).toEqual([
      { type: 'client', code: 'C1', hub: true },
      { type: 'service', code: 'S1' },
    ]);
  });

  it("takes a service's department from Hub's service reference and a department step's values (S09)", () => {
    const withDepartment = parseCase(`
case: a Hub service with its department, and a manual service's department
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
steps:
  - event: invoice.issued
    accounting_date: 2026-12-03
    payload: { invoice: INV-1, client: C1, currency: SYP, syp_per_usd: "121.0000",
               lines: [{ line: L1, amount: 100, source: extra_work, service: { code: S1, department: design } }] }
  - service_department: { service: S3, department: video, effective_from: 2026-12-01 }
    reason: "خدمة يدوية"
expect:
  entries:
    - source: invoice.issued
      date: 2026-12-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 100, book: 100 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -100, book: -100 }
`);
    expect(eventValues(withDepartment)).toEqual([
      { type: 'client', code: 'C1' },
      { type: 'service', code: 'S1' },
      { type: 'department', code: 'design' },
    ]);
    expect(namedDimensionValues(withDepartment)).toEqual([
      { type: 'service', code: 'S3' },
      { type: 'department', code: 'video' },
    ]);
  });
});
