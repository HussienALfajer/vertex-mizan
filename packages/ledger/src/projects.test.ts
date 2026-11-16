import { type CompanyLedgers, type CurrencyCode, money } from '@vertex-mizan/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { balanceEntry, ledgerTotal } from './balance.js';
import { reverseLines } from './carried.js';
import { emptyBalance, type ItemState } from './items.js';
import { keptLedgers, type Line, ledgerAmount } from './lines.js';
import { manualEntry } from './manual.js';
import type { MeasureContext } from './measure.js';
import {
  type BillingDocument,
  type BuiltDocument,
  buildProjectDocument,
  type LineQuantity,
  type PurchaseDocument,
  type PurchaseLine,
  resolveLineAmount,
  type WageSheetDocument,
} from './projects.js';
import { calendar, rate, refusal } from './test-fixtures.js';

// S12 rules 4–13 with the numbers of `projects/purchase-invoice` and `projects/wage-sheet`. Every
// amount and rate is synthetic; account codes are `contracting@1`'s.

const client: CompanyLedgers = {
  book: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
  parallel: {
    currency: 'SYP',
    ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
  },
};
const third: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};
const realised = { gain: { account: '421001' }, loss: { account: '541001' } };
const rounding = { account: '421003' };

const december3 = [
  rate('TRY', 'SYP', '3.5000', 'bulletin', '2026-12-03'),
  rate('USD', 'TRY', '34.0000', 'market', '2026-12-03'),
];
const at = (ledgers: CompanyLedgers, on = '2026-12-03', rates = december3): MeasureContext => ({
  ledgers,
  on,
  rates,
  calendar,
});

const running = (id: string, balance: ItemState['balance']): ItemState => ({
  id,
  kind: 'running',
  direction: null,
  balance,
});
const fresh = (id: string, currency: CurrencyCode, ledgers = client): ItemState =>
  running(id, emptyBalance(currency, ledgers.parallel !== null));

const quantity = (
  materialId: string | null,
  value: string,
  unitPrice: string | null,
  unit = 'طن',
): LineQuantity => ({ materialId, unit, quantity: value, unitPrice });

const cost = (
  account: string,
  currency: CurrencyCode,
  input: Partial<PurchaseLine>,
): PurchaseLine => ({
  account,
  dimensions: { contract: 'P1' },
  currency,
  requiresMaterial: account === '511001',
  amountMinor: null,
  quantity: null,
  advanceMinor: null,
  ...input,
});

const cement = cost('511001', 'TRY', { quantity: quantity('CEM', '12.500', '3150.0000') });
const steel = cost('511001', 'TRY', { quantity: quantity('STL', '2.000', '23800.0000') });

/** S1's advance on P1: 30,000.00 TRY paid on 2 November at 33 and 3.4. */
const advanceOf = (ledgers: CompanyLedgers) =>
  running('S1-advance', {
    transaction: money(3_000_000n, 'TRY'),
    bookMinor: ledgers === client ? 90_909n : 10_200_000n,
    parallelMinor: ledgers === client ? 10_200_000n : 90_909n,
  });

function purchase(
  input: Partial<PurchaseDocument> & { readonly lines: readonly PurchaseLine[] },
  ledgers = client,
): PurchaseDocument {
  const currency = input.lines[0]?.currency ?? 'TRY';
  return {
    kind: 'purchase',
    currency,
    advanceMinor: null,
    supplier: {
      account: '211001',
      dimensions: { supplier: 'S1', contract: 'P1' },
      item: fresh('S1', currency, ledgers),
    },
    advance: {
      account: '114002',
      dimensions: { supplier: 'S1', contract: 'P1' },
      side: 1,
      shares: [advanceOf(ledgers)],
    },
    ...input,
  };
}

/** The document's posted lines: its manual entry's lines, balanced. */
function posted(built: BuiltDocument, context: MeasureContext): Line[] {
  const { lines } = manualEntry(built.entry, context, realised);
  return balanceEntry({ on: context.on, ledgers: context.ledgers, lines, rounding });
}

const view = (lines: readonly Line[]) =>
  lines.map((line) => [
    line.account,
    line.transaction.amountMinor,
    line.bookMinor,
    line.parallelMinor,
  ]);

describe('a line’s amount from its quantity (S12 rules 4–6)', () => {
  const typed = (input: Partial<Parameters<typeof resolveLineAmount>[0]>) =>
    resolveLineAmount(
      { requiresMaterial: true, currency: 'USD', amountMinor: null, quantity: null, ...input },
      3,
    );

  it('is the rounded product, or a typed price adjustment', () => {
    expect(typed({ quantity: quantity('SND', '12.500', '3.0300') }).amount.amountMinor).toBe(3788n);
    expect(typed({ quantity: quantity('SND', '-2.500', '3.0300') }).amount.amountMinor).toBe(-758n);
    expect(
      typed({ quantity: quantity('CEM', '0.000', null), amountMinor: -5000n }).amount.amountMinor,
    ).toBe(-5000n);
    expect(
      resolveLineAmount(
        { requiresMaterial: false, currency: 'USD', amountMinor: 12000n, quantity: null },
        1,
      ).amount.amountMinor,
    ).toBe(12000n);
  });

  it('refuses what the scenario refuses, naming the line', () => {
    expect(refusal(() => typed({ amountMinor: 100000n }))).toBe('MATERIAL_REQUIRED');
    expect(refusal(() => typed({ quantity: quantity(null, '1.000', '1.0000') }))).toBe(
      'MATERIAL_REQUIRED',
    );
    expect(refusal(() => typed({ quantity: quantity('CEM', '0.000', null) }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(refusal(() => typed({ quantity: quantity('SND', '0.125', '0.0300') }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(refusal(() => typed({ quantity: quantity('CEM', '1.000', null) }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      refusal(() => typed({ quantity: quantity('CEM', '1.000', '1.0000'), amountMinor: 99n })),
    ).toBe('VALIDATION_FAILED');
    try {
      typed({ amountMinor: 1n });
    } catch (error) {
      expect(error).toMatchObject({ details: { lineNo: 3 } });
    }
  });
});

describe('a project purchase invoice (S12 rules 7–8, 12)', () => {
  it("is S12's example: two quantities and the supplier's new running item", () => {
    const built = buildProjectDocument(purchase({ lines: [cement, steel] }), at(client));
    expect(built.totalMinor).toBe(8_697_500n);
    expect(built.quantities).toEqual([cement.quantity, steel.quantity, null]);
    expect(view(posted(built, at(client)))).toEqual([
      ['511001', 3_937_500n, 115_809n, 13_781_250n],
      ['511001', 4_760_000n, 140_000n, 16_660_000n],
      ['211001', -8_697_500n, -255_809n, -30_441_250n],
    ]);
  });

  it('rounds each line half away from zero, a return, a discount and a line with no material', () => {
    const on = '2026-12-10';
    const rates = [rate('USD', 'SYP', '120.0000', 'bulletin', on)];
    const usd = (input: Partial<PurchaseLine>, account = '511001') => cost(account, 'USD', input);
    const built = buildProjectDocument(
      purchase({
        lines: [
          usd({ quantity: quantity('SND', '12.500', '3.0300', 'م³') }),
          usd({ quantity: quantity('SND', '-2.500', '3.0300', 'م³') }),
          usd({ quantity: quantity('CEM', '20.000', '92.5000') }),
          usd({ quantity: quantity('CEM', '0.000', null), amountMinor: -5000n }),
          usd({ amountMinor: 12000n }, '511005'),
        ],
      }),
      at(client, on, rates),
    );
    expect(view(posted(built, at(client, on, rates)))).toEqual([
      ['511001', 3788n, 3788n, 454_560n],
      ['511001', -758n, -758n, -90_960n],
      ['511001', 185_000n, 185_000n, 22_200_000n],
      ['511001', -5000n, -5000n, -600_000n],
      ['511005', 12_000n, 12_000n, 1_440_000n],
      ['211001', -195_030n, -195_030n, -23_403_600n],
    ]);
  });

  it('takes the covered cost at the advance’s carried amounts, allocated by default', () => {
    const built = buildProjectDocument(
      purchase({ lines: [cement, steel], advanceMinor: 1_500_000n }),
      at(client),
    );
    expect(built.advanceLine).toBe(2);
    expect(view(posted(built, at(client)))).toEqual([
      ['511001', 3_937_500n, 116_414n, 13_713_343n],
      ['511001', 4_760_000n, 140_732n, 16_577_907n],
      ['114002', -1_500_000n, -45_455n, -5_100_000n],
      ['211001', -7_197_500n, -211_691n, -25_191_250n],
    ]);
  });

  it('takes it on the line the accountant typed it on', () => {
    const built = buildProjectDocument(
      purchase({
        lines: [cement, { ...steel, advanceMinor: 1_500_000n }],
        advanceMinor: 1_500_000n,
      }),
      at(client),
    );
    expect(view(posted(built, at(client)))).toEqual([
      ['511001', 3_937_500n, 115_809n, 13_781_250n],
      ['511001', 4_760_000n, 141_337n, 16_510_000n],
      ['114002', -1_500_000n, -45_455n, -5_100_000n],
      ['211001', -7_197_500n, -211_691n, -25_191_250n],
    ]);
  });

  it('does the same in SYP books with a USD parallel ledger', () => {
    const built = buildProjectDocument(
      purchase({ lines: [cement, steel], advanceMinor: 1_500_000n }, third),
      at(third),
    );
    expect(view(posted(built, at(third)))).toEqual([
      ['511001', 3_937_500n, 13_713_343n, 116_414n],
      ['511001', 4_760_000n, 16_577_907n, 140_732n],
      ['114002', -1_500_000n, -5_100_000n, -45_455n],
      ['211001', -7_197_500n, -25_191_250n, -211_691n],
    ]);
  });

  it("clears the supplier's debit balance at what it carries and realises the residual", () => {
    const document = purchase({ lines: [cement, steel] });
    const debit = running('S1', {
      transaction: money(1_020_000n, 'TRY'),
      bookMinor: 30_909n,
      parallelMinor: 3_468_000n,
    });
    const built = buildProjectDocument(
      { ...document, supplier: { ...document.supplier, item: debit } },
      at(client),
    );
    expect(view(posted(built, at(client)))).toEqual([
      ['511001', 3_937_500n, 115_809n, 13_781_250n],
      ['511001', 4_760_000n, 140_000n, 16_660_000n],
      ['211001', -1_020_000n, -30_909n, -3_468_000n],
      ['211001', -7_677_500n, -225_809n, -26_871_250n],
      ['541001', 909n, 909n, 0n],
      ['421001', -102_000n, 0n, -102_000n],
    ]);
  });

  it('refuses an advance in another currency, beyond the share, or above the total', () => {
    const usdLine = cost('511006', 'USD', { amountMinor: 50_000n });
    expect(
      refusal(() =>
        buildProjectDocument(
          purchase({ lines: [usdLine], advanceMinor: 50_000n }),
          at(client, '2026-12-03', [
            ...december3,
            rate('USD', 'SYP', '120.0000', 'bulletin', '2026-12-03'),
          ]),
        ),
      ),
    ).toBe('ADVANCE_CURRENCY_MISMATCH');
    expect(
      refusal(() =>
        buildProjectDocument(
          purchase({ lines: [cement, steel], advanceMinor: 3_500_000n }),
          at(client),
        ),
      ),
    ).toBe('RELEASE_EXCEEDS_BALANCE');
    expect(
      refusal(() =>
        buildProjectDocument(
          purchase({
            lines: [cement, steel],
            advanceMinor: 1_000_000n,
            advance: { account: '114002', dimensions: {}, side: 1, shares: [] },
          }),
          at(client),
        ),
      ),
    ).toBe('RELEASE_EXCEEDS_BALANCE');
    expect(
      refusal(() =>
        buildProjectDocument(
          purchase({
            lines: [cost('511006', 'TRY', { amountMinor: 100n })],
            advanceMinor: 200n,
          }),
          at(client),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      refusal(() =>
        buildProjectDocument(
          purchase({
            lines: [cement, { ...steel, advanceMinor: 1_000n }],
            advanceMinor: 1_500_000n,
          }),
          at(client),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('refuses an advance from a project whose share is on the other side (a credit)', () => {
    const credited = running('S1-advance', {
      transaction: money(-2_000_000n, 'TRY'),
      bookMinor: -60_000n,
      parallelMinor: -6_800_000n,
    });
    const document = purchase({ lines: [cement, steel], advanceMinor: 1_000_000n });
    expect(
      refusal(() =>
        buildProjectDocument(
          { ...document, advance: { ...document.advance, shares: [credited] } },
          at(client),
        ),
      ),
    ).toBe('RELEASE_EXCEEDS_BALANCE');
    // Held only on the other side in another currency is no advance in another currency either.
    const usdCredit = running('S1-usd', {
      transaction: money(-10_000n, 'USD'),
      bookMinor: -10_000n,
      parallelMinor: -1_200_000n,
    });
    expect(
      refusal(() =>
        buildProjectDocument(
          { ...document, advance: { ...document.advance, shares: [usdCredit] } },
          at(client),
        ),
      ),
    ).toBe('RELEASE_EXCEEDS_BALANCE');
  });

  it('puts the advance back at exactly what it cleared when reversed', () => {
    const built = buildProjectDocument(
      purchase({ lines: [cement, steel], advanceMinor: 1_500_000n }),
      at(client),
    );
    const lines = posted(built, at(client));
    const reversal = reverseLines(lines);
    const back = balanceEntry({ on: '2026-12-10', ledgers: client, lines: reversal, rounding });
    expect(view(back.filter((line) => line.account === '114002'))).toEqual([
      ['114002', 1_500_000n, 45_455n, 5_100_000n],
    ]);
    for (const line of back) {
      if (line.kind === 'measured' && line.covered !== undefined) {
        expect(line.covered.transaction.amountMinor < 0n).toBe(true);
      }
    }
  });
});

describe('the covered parts (S12 rule 12, IFRIC 22.8)', () => {
  it('sum to the clearing line in every ledger, leave no residual and net to zero reversed', () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 1n, max: 50_000_000n }), { minLength: 1, maxLength: 6 }),
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.bigInt({ min: 1n, max: 10_000_000n }),
        fc.bigInt({ min: 1n, max: 10_000_000n }),
        fc.nat({ max: 1000 }),
        (amounts, advanceRaw, book, parallel, share) => {
          let total = 0n;
          for (const amount of amounts) total += amount;
          const held = total + advanceRaw;
          const advanceMinor = (total * BigInt(share)) / 1000n;
          const document = purchase({
            lines: amounts.map((amountMinor) => cost('511006', 'TRY', { amountMinor })),
            advanceMinor: advanceMinor === 0n ? null : advanceMinor,
            advance: {
              account: '114002',
              dimensions: {},
              side: 1,
              shares: [
                running('A', {
                  transaction: money(held, 'TRY'),
                  bookMinor: book,
                  parallelMinor: parallel,
                }),
              ],
            },
          });
          const built = buildProjectDocument(document, at(client));
          const lines = posted(built, at(client));
          for (const [ledger] of keptLedgers(client)) {
            expect(ledgerTotal(lines, ledger)).toBe(0n);
            let covered = 0n;
            for (const line of lines) {
              if (line.kind === 'measured' && line.covered !== undefined) {
                covered += ledgerAmount(line.covered, ledger) ?? 0n;
              }
            }
            const clearing = lines.find((line) => line.account === '114002');
            expect(covered).toBe(
              clearing === undefined ? 0n : -(ledgerAmount(clearing, ledger) ?? 0n),
            );
          }
          const back = balanceEntry({
            on: '2026-12-10',
            ledgers: client,
            lines: reverseLines(lines),
            rounding,
          });
          for (const [ledger] of keptLedgers(client)) {
            expect(ledgerTotal([...lines, ...back], ledger)).toBe(0n);
          }
        },
      ),
    );
  });
});

describe('a wage sheet (S12 rule 10)', () => {
  const on = '2026-12-15';
  const rates = [rate('USD', 'SYP', '120.0000', 'bulletin', on)];
  const worker = (id: string, item = fresh(id, 'USD')) => ({
    account: '211007',
    dimensions: { worker: id, contract: 'P1' },
    item,
  });
  const days = (value: string, rateText: string) => quantity(null, value, rateText, 'يوم');
  const sheet = (input: Partial<WageSheetDocument> = {}): WageSheetDocument => ({
    kind: 'wage_sheet',
    currency: 'USD',
    on,
    periodFrom: '2026-12-01',
    periodTo: on,
    wagesAccount: '511002',
    lines: [
      {
        worker: 'W1',
        dimensions: { contract: 'P1', worker: 'W1' },
        quantity: days('6.000', '25.0000'),
        amountMinor: null,
        memo: null,
      },
      {
        worker: 'W2',
        dimensions: { contract: 'P1', worker: 'W2' },
        quantity: null,
        amountMinor: 40_000n,
        memo: 'نجارة قوالب الطابق الأول',
      },
    ],
    workers: new Map([
      ['W1', worker('W1')],
      ['W2', worker('W2')],
    ]),
    ...input,
  });

  it("is S12's example: days and a lump sum, one credit per worker", () => {
    const built = buildProjectDocument(sheet(), at(client, on, rates));
    expect(built.quantities).toEqual([days('6.000', '25.0000'), null, null, null]);
    expect(built.memos).toEqual([null, 'نجارة قوالب الطابق الأول', null, null]);
    expect(view(posted(built, at(client, on, rates)))).toEqual([
      ['511002', 15_000n, 15_000n, 1_800_000n],
      ['511002', 40_000n, 40_000n, 4_800_000n],
      ['211007', -15_000n, -15_000n, -1_800_000n],
      ['211007', -40_000n, -40_000n, -4_800_000n],
    ]);
  });

  it("nets a worker's advance at what it carries, the parallel residual realised", () => {
    const advanced = running('W1', {
      transaction: money(10_000n, 'USD'),
      bookMinor: 10_000n,
      parallelMinor: 1_180_000n,
    });
    const built = buildProjectDocument(
      sheet({
        workers: new Map([
          ['W1', worker('W1', advanced)],
          ['W2', worker('W2')],
        ]),
      }),
      at(client, on, rates),
    );
    expect(view(posted(built, at(client, on, rates)))).toEqual([
      ['511002', 15_000n, 15_000n, 1_800_000n],
      ['511002', 40_000n, 40_000n, 4_800_000n],
      ['211007', -10_000n, -10_000n, -1_180_000n],
      ['211007', -5_000n, -5_000n, -600_000n],
      ['211007', -40_000n, -40_000n, -4_800_000n],
      ['421001', -20_000n, 0n, -20_000n],
    ]);
  });

  it('converts each line on its own in TRY, the residual a rounding line', () => {
    const tryOn = '2026-12-31';
    const tryRates = [
      rate('TRY', 'SYP', '3.5000', 'bulletin', tryOn),
      rate('USD', 'TRY', '34.0000', 'market', tryOn),
    ];
    const w = (id: string) => ({ ...worker(id, fresh(id, 'TRY')) });
    const built = buildProjectDocument(
      sheet({
        currency: 'TRY',
        on: tryOn,
        periodTo: tryOn,
        lines: [
          {
            worker: 'W3',
            dimensions: { worker: 'W3' },
            quantity: days('12.500', '860.0000'),
            amountMinor: null,
            memo: null,
          },
          {
            worker: 'W3',
            dimensions: { worker: 'W3' },
            quantity: null,
            amountMinor: 150_000n,
            memo: 'تمديدات',
          },
          {
            worker: 'W4',
            dimensions: { worker: 'W4' },
            quantity: days('1.500', '933.3300'),
            amountMinor: null,
            memo: null,
          },
        ],
        workers: new Map([
          ['W3', w('W3')],
          ['W4', w('W4')],
        ]),
      }),
      at(client, tryOn, tryRates),
    );
    const lines = posted(built, at(client, tryOn, tryRates));
    expect(lines.map((line) => line.transaction.amountMinor)).toEqual([
      1_075_000n,
      150_000n,
      140_000n,
      -1_225_000n,
      -140_000n,
      expect.any(BigInt),
    ]);
    expect(lines.at(-1)?.kind).toBe('rounding');
  });

  it('refuses a date, a period, days and a lump sum the rule refuses', () => {
    const [first, second] = sheet().lines;
    if (first === undefined || second === undefined) throw new Error('two lines');
    for (const [input, why] of [
      [{ on: '2026-12-14' }, 'dated before its last day'],
      [{ periodFrom: '2026-11-25' }, 'across two months'],
      [{ lines: [{ ...first, quantity: days('2.250', '25.0000') }] }, 'two decimals'],
      [{ lines: [{ ...first, quantity: days('-1.000', '25.0000') }] }, 'negative days'],
      [{ lines: [{ ...second, memo: null }] }, 'a lump sum with no description'],
      [{ lines: [{ ...first, quantity: quantity('CEM', '1.000', '1.0000') }] }, 'a material'],
      [{ lines: [] }, 'no line'],
    ] as const) {
      expect(
        refusal(() => buildProjectDocument(sheet(input), at(client, on, rates))),
        why,
      ).toBe('VALIDATION_FAILED');
    }
  });
});

// S12 rules 14–20 with the numbers of `projects/progress-billing`, `projects/subcontract-billing`
// and `projects/retention-release`.

const december31 = [
  rate('USD', 'SYP', '120.0000', 'bulletin', '2026-12-31'),
  rate('TRY', 'SYP', '3.5000', 'bulletin', '2026-12-31'),
  rate('USD', 'TRY', '34.3000', 'market', '2026-12-31'),
];
const onDecember31 = (ledgers: CompanyLedgers = client) => at(ledgers, '2026-12-31', december31);

const newDocumentItem = (id: string, currency: CurrencyCode, ledgers = client): ItemState => ({
  id,
  kind: 'document',
  direction: null,
  opensAs: 1,
  balance: emptyBalance(currency, ledgers.parallel !== null),
});

/** C1's advance on P1: 20,000.00 USD received on 2 November at 115 (a credit). */
const clientAdvance = running('C1-advance', {
  transaction: money(-2_000_000n, 'USD'),
  bookMinor: -2_000_000n,
  parallelMinor: -230_000_000n,
});

function progressBilling(input: Partial<BillingDocument>, ledgers = client): BillingDocument {
  const currency = input.currency ?? 'USD';
  const dimensions = { client: 'C1', contract: 'P1' };
  return {
    kind: 'progress_billing',
    currency,
    on: '2026-12-31',
    cumulativeMinor: 3_000_000n,
    previous: null,
    retentionBp: 1000,
    advanceRecoveryBp: 2000,
    retentionMinor: null,
    advanceMinor: null,
    value: { account: '411001', dimensions },
    net: { account: '112001', dimensions, item: newDocumentItem('N1', currency, ledgers) },
    retention: { account: '113002', dimensions, item: newDocumentItem('R1', currency, ledgers) },
    advance: { account: '212002', dimensions, side: -1, shares: [clientAdvance] },
    ...input,
  };
}

/** S2's advance on P1: 300,000.00 TRY paid on 2 November at 33 and 3.4 (a debit). */
const supplierAdvance = running('S2-advance', {
  transaction: money(30_000_000n, 'TRY'),
  bookMinor: 909_091n,
  parallelMinor: 102_000_000n,
});

function subcontractBilling(input: Partial<BillingDocument>): BillingDocument {
  const dimensions = { supplier: 'S2', contract: 'P1' };
  return {
    kind: 'subcontract_billing',
    currency: 'TRY',
    on: '2026-12-31',
    cumulativeMinor: 60_000_000n,
    previous: null,
    retentionBp: 1000,
    advanceRecoveryBp: 2000,
    retentionMinor: null,
    advanceMinor: null,
    value: { account: '511003', dimensions: { contract: 'P1', supplier: 'S2' } },
    net: { account: '211002', dimensions, item: fresh('S2-payable', 'TRY') },
    retention: { account: '211006', dimensions, item: fresh('S2-retention', 'TRY') },
    advance: { account: '114002', dimensions, side: 1, shares: [supplierAdvance] },
    ...input,
  };
}

describe("a client's progress billing (S12 rules 14–16)", () => {
  it("is S12's example: the covered revenue at the advance's carrying amount, no difference", () => {
    const built = buildProjectDocument(progressBilling({}), onDecember31());
    expect([built.totalMinor, built.retentionMinor, built.advanceMinor, built.netMinor]).toEqual([
      3_000_000n,
      300_000n,
      600_000n,
      2_100_000n,
    ]);
    expect(built.advanceLine).toBe(2);
    expect(view(posted(built, onDecember31()))).toEqual([
      ['112001', 2_100_000n, 2_100_000n, 252_000_000n],
      ['113002', 300_000n, 300_000n, 36_000_000n],
      ['212002', 600_000n, 600_000n, 69_000_000n],
      ['411001', -3_000_000n, -3_000_000n, -357_000_000n],
    ]);
  });

  it('takes the previous cumulative, a typed recovery, and caps the computed one', () => {
    const left = running('C1-advance', {
      transaction: money(-400_000n, 'USD'),
      bookMinor: -400_000n,
      parallelMinor: -46_000_000n,
    });
    const rates = [rate('USD', 'SYP', '130.0000', 'bulletin', '2027-02-28')];
    const context = at(client, '2027-02-28', rates);
    const built = buildProjectDocument(
      progressBilling({
        on: '2027-02-28',
        cumulativeMinor: 11_000_000n,
        previous: { cumulativeMinor: 7_500_000n, on: '2027-01-31' },
        advance: {
          account: '212002',
          dimensions: { client: 'C1', contract: 'P1' },
          side: -1,
          shares: [left],
        },
      }),
      context,
    );
    expect([built.previousMinor, built.advanceMinor, built.netMinor]).toEqual([
      7_500_000n,
      400_000n,
      2_750_000n,
    ]);
    expect(view(posted(built, context))).toEqual([
      ['112001', 2_750_000n, 2_750_000n, 357_500_000n],
      ['113002', 350_000n, 350_000n, 45_500_000n],
      ['212002', 400_000n, 400_000n, 46_000_000n],
      ['411001', -3_500_000n, -3_500_000n, -449_000_000n],
    ]);
  });

  it('posts no receivable when the deductions take the whole value, and no advance line at 0', () => {
    const built = buildProjectDocument(
      progressBilling({ cumulativeMinor: 1_000_000n, advanceMinor: 900_000n }),
      onDecember31(),
    );
    expect(view(posted(built, onDecember31()))).toEqual([
      ['113002', 100_000n, 100_000n, 12_000_000n],
      ['212002', 900_000n, 900_000n, 103_500_000n],
      ['411001', -1_000_000n, -1_000_000n, -115_500_000n],
    ]);
    const none = buildProjectDocument(
      progressBilling({ advance: { account: '212002', dimensions: {}, side: -1, shares: [] } }),
      onDecember31(),
    );
    expect(none.advanceLine).toBeNull();
    expect(view(posted(none, onDecember31()))).toEqual([
      ['112001', 2_700_000n, 2_700_000n, 324_000_000n],
      ['113002', 300_000n, 300_000n, 36_000_000n],
      ['411001', -3_000_000n, -3_000_000n, -360_000_000n],
    ]);
  });

  it('measures a TRY billing in both ledgers, the book rounding realised', () => {
    const tryAdvance = running('C1-try', {
      transaction: money(-60_000_000n, 'TRY'),
      bookMinor: -1_818_182n,
      parallelMinor: -204_000_000n,
    });
    const built = buildProjectDocument(
      progressBilling({
        currency: 'TRY',
        cumulativeMinor: 90_000_000n,
        advance: { account: '212002', dimensions: {}, side: -1, shares: [tryAdvance] },
      }),
      onDecember31(),
    );
    expect(view(posted(built, onDecember31()))).toEqual([
      ['112001', 63_000_000n, 1_836_735n, 220_500_000n],
      ['113002', 9_000_000n, 262_391n, 31_500_000n],
      ['212002', 18_000_000n, 545_455n, 61_200_000n],
      ['411001', -90_000_000n, -2_644_580n, -313_200_000n],
      ['421001', -1n, -1n, 0n],
    ]);
  });

  it('refuses a billing not increasing, back-dated, over-deducted or over-recovered', () => {
    const previous = { cumulativeMinor: 3_000_000n, on: '2026-12-31' };
    expect(
      refusal(() =>
        buildProjectDocument(
          progressBilling({ cumulativeMinor: 3_000_000n, previous }),
          onDecember31(),
        ),
      ),
    ).toBe('BILLING_NOT_INCREASING');
    expect(
      refusal(() => buildProjectDocument(progressBilling({ cumulativeMinor: 0n }), onDecember31())),
    ).toBe('BILLING_NOT_INCREASING');
    expect(
      refusal(() =>
        buildProjectDocument(
          progressBilling({
            on: '2026-12-30',
            cumulativeMinor: 5_000_000n,
            previous,
          }),
          at(client, '2026-12-30', [rate('USD', 'SYP', '120.0000', 'bulletin', '2026-12-30')]),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      refusal(() =>
        buildProjectDocument(
          progressBilling({ retentionMinor: 2_000_000n, advanceMinor: 1_500_000n }),
          onDecember31(),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      refusal(() =>
        buildProjectDocument(progressBilling({ advanceMinor: 2_100_000n }), onDecember31()),
      ),
    ).toBe('RELEASE_EXCEEDS_BALANCE');
  });

  it("refuses a typed recovery while the project's advance is held only in another currency", () => {
    const tryAdvance = running('C1-try', {
      transaction: money(-60_000_000n, 'TRY'),
      bookMinor: -1_818_182n,
      parallelMinor: -204_000_000n,
    });
    const document = progressBilling({
      advance: { account: '212002', dimensions: {}, side: -1, shares: [tryAdvance] },
    });
    expect(
      refusal(() => buildProjectDocument({ ...document, advanceMinor: 600_000n }, onDecember31())),
    ).toBe('ADVANCE_CURRENCY_MISMATCH');
    // The computed recovery is capped at the 0 held in the document's currency.
    expect(buildProjectDocument(document, onDecember31()).advanceMinor).toBe(0n);
  });
});

describe("a subcontractor's billing (S12 rule 18)", () => {
  it("is the scenario's billing 1: the covered cost at the advance's carried amounts", () => {
    const built = buildProjectDocument(subcontractBilling({}), onDecember31());
    expect(view(posted(built, onDecember31()))).toEqual([
      ['511003', 60_000_000n, 1_763_053n, 208_800_000n],
      ['211006', -6_000_000n, -174_927n, -21_000_000n],
      ['114002', -12_000_000n, -363_636n, -40_800_000n],
      ['211002', -42_000_000n, -1_224_490n, -147_000_000n],
    ]);
  });

  it('caps the recovery at what is left and realises the book rounding', () => {
    const left = running('S2-advance', {
      transaction: money(18_000_000n, 'TRY'),
      bookMinor: 545_455n,
      parallelMinor: 61_200_000n,
    });
    const rates = [
      rate('TRY', 'SYP', '3.6500', 'bulletin', '2027-01-31'),
      rate('USD', 'TRY', '35.8400', 'market', '2027-01-31'),
    ];
    const context = at(client, '2027-01-31', rates);
    const built = buildProjectDocument(
      subcontractBilling({
        on: '2027-01-31',
        cumulativeMinor: 160_000_000n,
        previous: { cumulativeMinor: 60_000_000n, on: '2026-12-31' },
        advance: { account: '114002', dimensions: {}, side: 1, shares: [left] },
      }),
      context,
    );
    expect(view(posted(built, context))).toEqual([
      ['511003', 100_000_000n, 2_833_401n, 360_500_000n],
      ['211006', -10_000_000n, -279_018n, -36_500_000n],
      ['114002', -18_000_000n, -545_455n, -61_200_000n],
      ['211002', -72_000_000n, -2_008_929n, -262_800_000n],
      ['541001', 1n, 1n, 0n],
    ]);
  });
});

describe('the billing deductions (S12 rule 15)', () => {
  it('sum to the period’s value with the net, never below zero, and the entry balances', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 50_000_000n }),
        fc.bigInt({ min: 1n, max: 50_000_000n }),
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 0, max: 5000 }),
        fc.bigInt({ min: 0n, max: 30_000_000n }),
        (previousMinor, periodMinor, retentionBp, advanceRecoveryBp, heldMinor) => {
          const advance = running('C1-advance', {
            transaction: money(-heldMinor, 'USD'),
            bookMinor: -heldMinor,
            parallelMinor: -heldMinor * 115n,
          });
          const built = buildProjectDocument(
            progressBilling({
              cumulativeMinor: previousMinor + periodMinor,
              previous:
                previousMinor === 0n ? null : { cumulativeMinor: previousMinor, on: '2026-12-01' },
              retentionBp,
              advanceRecoveryBp,
              advance: { account: '212002', dimensions: {}, side: -1, shares: [advance] },
            }),
            onDecember31(),
          );
          expect(built.totalMinor).toBe(periodMinor);
          expect(built.retentionMinor + built.advanceMinor + built.netMinor).toBe(periodMinor);
          expect(built.netMinor >= 0n).toBe(true);
          expect(built.advanceMinor <= heldMinor).toBe(true);
          const lines = posted(built, onDecember31());
          for (const [ledger] of keptLedgers(client)) expect(ledgerTotal(lines, ledger)).toBe(0n);
        },
      ),
    );
  });
});

describe('a retention release (S12 rules 19–20)', () => {
  const february28 = [rate('USD', 'SYP', '130.0000', 'bulletin', '2027-02-28')];
  const context = at(client, '2027-02-28', february28);
  const retention = (id: string, amount: bigint, parallel: bigint): ItemState => ({
    id,
    kind: 'document',
    direction: 1,
    balance: { transaction: money(amount, 'USD'), bookMinor: amount, parallelMinor: parallel },
  });
  const dimensions = { client: 'C1', contract: 'P1' };

  it("moves the client's retentions into one receivable, the parallel residual realised", () => {
    const built = buildProjectDocument(
      {
        kind: 'retention_release',
        side: 'client',
        currency: 'USD',
        items: [
          {
            target: { account: '113002', dimensions, item: retention('R1', 300_000n, 36_000_000n) },
            amountMinor: 300_000n,
          },
          {
            target: { account: '113002', dimensions, item: retention('R2', 200_000n, 25_000_000n) },
            amountMinor: 200_000n,
          },
        ],
        receivable: { account: '112001', dimensions, item: newDocumentItem('N', 'USD') },
      },
      context,
    );
    expect(built.retentionMinor).toBe(500_000n);
    expect(view(posted(built, context))).toEqual([
      ['112001', 500_000n, 500_000n, 65_000_000n],
      ['113002', -300_000n, -300_000n, -36_000_000n],
      ['113002', -200_000n, -200_000n, -25_000_000n],
      ['421001', -4_000_000n, 0n, -4_000_000n],
    ]);
  });

  it('refuses a release above an item’s open amount when its entry is built', () => {
    expect(
      refusal(() =>
        posted(
          buildProjectDocument(
            {
              kind: 'retention_release',
              side: 'client',
              currency: 'USD',
              items: [
                {
                  target: {
                    account: '113002',
                    dimensions,
                    item: retention('R1', 200_000n, 24_000_000n),
                  },
                  amountMinor: 250_000n,
                },
              ],
              receivable: { account: '112001', dimensions, item: newDocumentItem('N', 'USD') },
            },
            context,
          ),
          context,
        ),
      ),
    ).toBe('RELEASE_EXCEEDS_BALANCE');
  });

  it("clears the supplier's retention at the project's own average, refused beyond it", () => {
    const share = running('S2-retention', {
      transaction: money(-300_000n, 'USD'),
      bookMinor: -300_000n,
      parallelMinor: -36_000_000n,
    });
    const supplier = { supplier: 'S2', contract: 'P1' };
    const release = (amountMinor: bigint) =>
      buildProjectDocument(
        {
          kind: 'retention_release',
          side: 'supplier',
          currency: 'USD',
          amountMinor,
          retention: { account: '211006', dimensions: supplier, side: -1, shares: [share] },
          payable: { account: '211002', dimensions: supplier, item: fresh('S2-payable', 'USD') },
        },
        context,
      );
    expect(view(posted(release(300_000n), context))).toEqual([
      ['211006', 300_000n, 300_000n, 36_000_000n],
      ['211002', -300_000n, -300_000n, -39_000_000n],
      ['541001', 3_000_000n, 0n, 3_000_000n],
    ]);
    expect(refusal(() => release(350_000n))).toBe('RELEASE_EXCEEDS_BALANCE');
  });
});
