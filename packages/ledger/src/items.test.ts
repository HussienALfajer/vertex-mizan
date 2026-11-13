import { type ExchangeRate, type Money, money } from '@vertex-mizan/contracts';
import { describe, expect, it } from 'vitest';
import { balanceEntry } from './balance.js';
import {
  checkDueDate,
  checkItemLine,
  emptyBalance,
  type ItemState,
  itemPositions,
  moveItem,
  movementOn,
  runningVoidDifference,
  runningVoidDifferenceLines,
} from './items.js';
import { type CarriedAmounts, type Line, negate } from './lines.js';
import { manualEntry, manualReversalLines } from './manual.js';
import type { MeasureContext } from './measure.js';
import { calendar, rate, refusal, sypOnly, sypUsd } from './test-fixtures.js';

/**
 * Worked examples of S04's item lines (rules 2–13, ADR 0013), with the numbers of the approved
 * scenarios `receivables/manual-settlement`, `receivables/write-off` and `ad-funds/running-balance`
 * (owner, 2026-11-06). Accounts by their service-agency codes; `C1` and `S1` stand for the client and
 * service values.
 */

const targets = { gain: { account: '421001' }, loss: { account: '541001' } };
const rounding = { account: '541003' };
const client = { client: 'C1' };

const at = (on: string, rates: readonly ExchangeRate[]): MeasureContext => ({
  ledgers: sypUsd,
  on,
  rates,
  calendar,
});

const bulletin = (value: string, on: string) => rate('USD', 'SYP', value, 'bulletin', on);
const market = (value: string, on: string) => rate('USD', 'SYP', value, 'market', on);

type Row = readonly [string, string, string, bigint, bigint, bigint | null, string | null];

/** A line as a row: kind, account, currency, amount, book, parallel and its item movement. */
function rows(lines: readonly Line[]): Row[] {
  return lines.map((line) => [
    line.kind,
    line.account,
    line.transaction.currency,
    line.transaction.amountMinor,
    line.bookMinor,
    line.parallelMinor,
    line.item === undefined ? null : `${line.item.id}:${line.item.movement}`,
  ]);
}

function sum(balance: CarriedAmounts, lines: readonly Line[], id: string): CarriedAmounts {
  return lines
    .filter((line) => line.item?.id === id)
    .reduce<CarriedAmounts>(
      (total, line) => ({
        transaction: money(
          total.transaction.amountMinor + line.transaction.amountMinor,
          total.transaction.currency,
        ),
        bookMinor: total.bookMinor + line.bookMinor,
        parallelMinor:
          total.parallelMinor === null ? null : total.parallelMinor + (line.parallelMinor ?? 0n),
      }),
      balance,
    );
}

const usd = (amount: bigint) => money(amount, 'USD');
const newDocument = (id: string, currency: Money['currency'] = 'USD'): ItemState => ({
  id,
  kind: 'document',
  direction: null,
  opensAs: 1,
  balance: emptyBalance(currency, true),
});

/** A manual entry through `manualEntry()` and `balanceEntry()`, as the posting function posts it. */
function post(
  context: MeasureContext,
  lines: Parameters<typeof manualEntry>[0]['lines'],
  dealtRates: readonly ExchangeRate[] = [],
): Line[] {
  const { lines: built } = manualEntry({ lines, dealtRates }, context, targets);
  return balanceEntry({ on: context.on, ledgers: context.ledgers, lines: built, rounding });
}

describe('a document item (S04 rules 2 and 4)', () => {
  const open = moveItem(
    newDocument('M-1'),
    { account: '112001', dimensions: client },
    usd(100_000n),
    at('2026-11-03', [bulletin('120.0000', '2026-11-03')]),
  );

  it('is opened by a new measurement, with the sign of its line', () => {
    expect(rows(open.lines)).toEqual([
      ['measured', '112001', 'USD', 100_000n, 12_000_000n, 100_000n, 'M-1:open'],
    ]);
    expect(open.after).toEqual({
      id: 'M-1',
      kind: 'document',
      direction: 1,
      balance: { transaction: usd(100_000n), bookMinor: 12_000_000n, parallelMinor: 100_000n },
    });
  });

  it('clears in proportion to what remains, reading no rate', () => {
    // No rate in the context: a clearing carries the item's amounts (ADR 0007, IAS 21.23(b)).
    const first = moveItem(
      open.after,
      { account: '112001', dimensions: client },
      usd(-40_000n),
      at('2026-11-19', []),
    );
    expect(rows(first.lines)).toEqual([
      ['carried', '112001', 'USD', -40_000n, -4_800_000n, -40_000n, 'M-1:clear'],
    ]);
    const last = moveItem(
      first.after,
      { account: '112001', dimensions: client },
      usd(-60_000n),
      at('2026-11-25', []),
    );
    expect(rows(last.lines)).toEqual([
      ['carried', '112001', 'USD', -60_000n, -7_200_000n, -60_000n, 'M-1:clear'],
    ]);
    expect(last.after.balance).toEqual(emptyBalance('USD', true));
  });

  it("refuses an opening against its account's normal balance: an advance is no credit item", () => {
    expect(
      refusal(() =>
        moveItem(
          newDocument('ADV-1'),
          { account: '112001', dimensions: { client: 'C2' } },
          usd(-50_000n),
          at('2026-11-19', [bulletin('123.0000', '2026-11-19')]),
        ),
      ),
    ).toBe('OPEN_ITEM_DIRECTION');
  });

  it('refuses a line that adds to it, and clearing more than is open', () => {
    const target = { account: '112001', dimensions: client };
    const none = at('2026-11-19', []);
    expect(refusal(() => moveItem(open.after, target, usd(1n), none))).toBe('OPEN_ITEM_DIRECTION');
    expect(refusal(() => moveItem(open.after, target, usd(-100_001n), none))).toBe(
      'RELEASE_EXCEEDS_BALANCE',
    );
    const settled = moveItem(open.after, target, usd(-100_000n), none).after;
    expect(refusal(() => moveItem(settled, target, usd(-1n), none))).toBe(
      'RELEASE_EXCEEDS_BALANCE',
    );
    expect(refusal(() => moveItem(settled, target, usd(1n), none))).toBe('OPEN_ITEM_DIRECTION');
  });
});

describe('a running item (S04 rule 3)', () => {
  const target = { account: '213001', dimensions: client };
  const funds: ItemState = {
    id: 'C1',
    kind: 'running',
    direction: null,
    balance: emptyBalance('USD', true),
  };
  const deposited = moveItem(
    funds,
    target,
    usd(-30_000n),
    at('2026-11-10', [bulletin('122.0000', '2026-11-10')]),
  );

  it('adds on a zero balance as a new measurement', () => {
    expect(rows(deposited.lines)).toEqual([
      ['measured', '213001', 'USD', -30_000n, -3_660_000n, -30_000n, 'C1:add'],
    ]);
  });

  it('splits a movement that crosses zero: the whole balance cleared, then the excess measured anew', () => {
    // receivables/manual-settlement, the offset: 400.00 USD against 300.00 carried at 122.
    const offset = moveItem(
      deposited.after,
      target,
      usd(40_000n),
      at('2026-11-19', [bulletin('123.0000', '2026-11-19')]),
    );
    expect(rows(offset.lines)).toEqual([
      ['carried', '213001', 'USD', 30_000n, 3_660_000n, 30_000n, 'C1:clear'],
      ['measured', '213001', 'USD', 10_000n, 1_230_000n, 10_000n, 'C1:add'],
    ]);
    expect(offset.after.balance).toEqual({
      transaction: usd(10_000n),
      bookMinor: 1_230_000n,
      parallelMinor: 10_000n,
    });
  });
});

describe('a manual line against its item (S04 rules 6–8)', () => {
  const item = {
    account: '112001',
    currency: 'USD',
    dimensions: { client: 'C1' },
    source: 'manual',
  } as const;
  const line = { account: '112001', currency: 'USD', dimensions: {}, memo: null } as const;

  it("takes the item's account, currency and dimensions", () => {
    expect(checkItemLine(line, item)).toEqual({ adjusted: false });
    expect(checkItemLine({ ...line, dimensions: { client: 'C1' } }, item)).toEqual({
      adjusted: false,
    });
    for (const change of [
      { account: '112002' },
      { currency: 'SYP' },
      { dimensions: { client: 'C2' } },
      { dimensions: { service: 'S1' } },
    ] as const) {
      expect(refusal(() => checkItemLine({ ...line, ...change }, item))).toBe('OPEN_ITEM_MISMATCH');
    }
  });

  it("needs a memo on a Hub item's movement, which is then adjusted in Mizan", () => {
    const hub = { ...item, source: 'hub_event' } as const;
    expect(refusal(() => checkItemLine(line, hub))).toBe('OPEN_ITEM_MEMO_REQUIRED');
    expect(refusal(() => checkItemLine({ ...line, memo: '  ' }, hub))).toBe(
      'OPEN_ITEM_MEMO_REQUIRED',
    );
    expect(checkItemLine({ ...line, memo: 'شطب' }, hub)).toEqual({ adjusted: true });
  });

  it('refuses a due date before the document date', () => {
    expect(refusal(() => checkDueDate('2026-11-03', '2026-12-03'))).toBe('none');
    expect(refusal(() => checkDueDate('2026-11-03', '2026-11-03'))).toBe('none');
    expect(refusal(() => checkDueDate('2026-11-03', '2026-11-02'))).toBe('VALIDATION_FAILED');
  });
});

describe('receivables/manual-settlement (rule 10)', () => {
  const rates = [
    bulletin('120.0000', '2026-11-03'),
    bulletin('123.0000', '2026-11-19'),
    bulletin('123.5000', '2026-11-25'),
    market('124.0000', '2026-11-25'),
  ];
  const invoice = post(at('2026-11-03', rates), [
    { account: '112001', dimensions: client, amount: usd(100_000n), item: newDocument('M-1') },
    { account: '411001', dimensions: { ...client, service: 'S1' }, amount: usd(-100_000n) },
  ]);
  const m1 = (balance: CarriedAmounts): ItemState => ({
    id: 'M-1',
    kind: 'document',
    direction: 1,
    balance,
  });

  it('the S04 example: a receipt in USD then one in SYP, each with its realised gain', () => {
    expect(rows(invoice)).toEqual([
      ['measured', '112001', 'USD', 100_000n, 12_000_000n, 100_000n, 'M-1:open'],
      ['measured', '411001', 'USD', -100_000n, -12_000_000n, -100_000n, null],
    ]);
    const afterInvoice = sum(emptyBalance('USD', true), invoice, 'M-1');
    const first = post(at('2026-11-19', rates), [
      { account: '111004', amount: usd(40_000n) },
      { account: '112001', dimensions: client, amount: usd(-40_000n), item: m1(afterInvoice) },
    ]);
    // One currency, but a carried line: the residual is a realised gain, never rounding.
    expect(rows(first)).toEqual([
      ['measured', '111004', 'USD', 40_000n, 4_920_000n, 40_000n, null],
      ['carried', '112001', 'USD', -40_000n, -4_800_000n, -40_000n, 'M-1:clear'],
      ['difference', '421001', 'SYP', -120_000n, -120_000n, 0n, null],
    ]);
    const final = post(at('2026-11-25', rates), [
      { account: '111003', amount: money(7_440_000n, 'SYP') },
      {
        account: '112001',
        dimensions: client,
        amount: usd(-60_000n),
        item: m1(sum(afterInvoice, first, 'M-1')),
      },
    ]);
    expect(rows(final)).toEqual([
      ['measured', '111003', 'SYP', 7_440_000n, 7_440_000n, 60_000n, null],
      ['carried', '112001', 'USD', -60_000n, -7_200_000n, -60_000n, 'M-1:clear'],
      ['difference', '421001', 'SYP', -240_000n, -240_000n, 0n, null],
    ]);
    expect(sum(sum(afterInvoice, first, 'M-1'), final, 'M-1')).toEqual(emptyBalance('USD', true));
  });

  it('the void of the first receipt reopens exactly what it cleared', () => {
    const afterInvoice = sum(emptyBalance('USD', true), invoice, 'M-1');
    const first = post(at('2026-11-19', rates), [
      { account: '111004', amount: usd(40_000n) },
      { account: '112001', dimensions: client, amount: usd(-40_000n), item: m1(afterInvoice) },
    ]);
    const void_ = manualReversalLines(
      { source: 'manual', date: '2026-11-19', isReversal: false, reversed: false, lines: first },
      '2026-11-26',
    );
    expect(rows(void_)).toEqual([
      ['measured', '111004', 'USD', -40_000n, -4_920_000n, -40_000n, null],
      ['carried', '112001', 'USD', 40_000n, 4_800_000n, 40_000n, 'M-1:clear'],
      ['difference', '421001', 'SYP', 120_000n, 120_000n, 0n, null],
    ]);
    expect(sum(sum(afterInvoice, first, 'M-1'), void_, 'M-1')).toEqual(afterInvoice);
  });

  it('an overpayment is refused on the item; its excess to a liability is a new measurement', () => {
    const afterInvoice = sum(emptyBalance('USD', true), invoice, 'M-1');
    const context = at('2026-11-19', rates);
    expect(
      refusal(() =>
        post(context, [
          { account: '111004', amount: usd(110_000n) },
          { account: '112001', dimensions: client, amount: usd(-110_000n), item: m1(afterInvoice) },
        ]),
      ),
    ).toBe('RELEASE_EXCEEDS_BALANCE');
    const received = post(context, [
      { account: '111004', amount: usd(110_000n) },
      { account: '112001', dimensions: client, amount: usd(-100_000n), item: m1(afterInvoice) },
      { account: '211003', amount: usd(-10_000n) },
    ]);
    expect(rows(received)).toEqual([
      ['measured', '111004', 'USD', 110_000n, 13_530_000n, 110_000n, null],
      ['carried', '112001', 'USD', -100_000n, -12_000_000n, -100_000n, 'M-1:clear'],
      ['measured', '211003', 'USD', -10_000n, -1_230_000n, -10_000n, null],
      ['difference', '421001', 'SYP', -300_000n, -300_000n, 0n, null],
    ]);
  });

  it('an item refusal names its manual line', () => {
    const afterInvoice = sum(emptyBalance('USD', true), invoice, 'M-1');
    expect(() =>
      manualEntry(
        {
          lines: [
            { account: '111004', amount: usd(1n) },
            { account: '112001', dimensions: client, amount: usd(1n), item: m1(afterInvoice) },
          ],
          dealtRates: [],
        },
        at('2026-11-19', rates),
        targets,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'OPEN_ITEM_DIRECTION',
        details: { itemId: 'M-1', lineNo: 2 },
      }),
    );
  });

  it('the offset against ad funds that crosses zero: two lines from one, a gain on the rest', () => {
    const offsetRates = [bulletin('122.0000', '2026-11-10'), bulletin('123.0000', '2026-11-19')];
    const afterInvoice = sum(emptyBalance('USD', true), invoice, 'M-1');
    const funds: ItemState = {
      id: 'C1',
      kind: 'running',
      direction: null,
      balance: { transaction: usd(-30_000n), bookMinor: -3_660_000n, parallelMinor: -30_000n },
    };
    const { lines, typed } = manualEntry(
      {
        lines: [
          { account: '213001', dimensions: client, amount: usd(40_000n), item: funds },
          { account: '112001', dimensions: client, amount: usd(-40_000n), item: m1(afterInvoice) },
        ],
        dealtRates: [],
      },
      at('2026-11-19', offsetRates),
      targets,
    );
    expect(rows(lines)).toEqual([
      ['carried', '213001', 'USD', 30_000n, 3_660_000n, 30_000n, 'C1:clear'],
      ['measured', '213001', 'USD', 10_000n, 1_230_000n, 10_000n, 'C1:add'],
      ['carried', '112001', 'USD', -40_000n, -4_800_000n, -40_000n, 'M-1:clear'],
      ['difference', '421001', 'SYP', -90_000n, -90_000n, 0n, null],
    ]);
    expect(typed).toEqual([0, 0, 1, null]);
  });

  it('an SYP item settled in SYP books posts no difference', () => {
    const syp = (on: string): MeasureContext => ({ ledgers: sypOnly, on, rates: [], calendar });
    const item: ItemState = {
      id: 'M-1',
      kind: 'document',
      direction: 1,
      balance: {
        transaction: money(12_000_000n, 'SYP'),
        bookMinor: 12_000_000n,
        parallelMinor: null,
      },
    };
    const lines = post(syp('2026-11-19'), [
      { account: '111003', amount: money(5_000_000n, 'SYP') },
      { account: '112001', dimensions: client, amount: money(-5_000_000n, 'SYP'), item },
    ]);
    expect(rows(lines)).toEqual([
      ['measured', '111003', 'SYP', 5_000_000n, 5_000_000n, null, null],
      ['carried', '112001', 'SYP', -5_000_000n, -5_000_000n, null, 'M-1:clear'],
    ]);
  });
});

describe('receivables/write-off (rule 11)', () => {
  it('clears the item at what it carries; the expense at the day, the gap a realised gain', () => {
    const item: ItemState = {
      id: 'M-1',
      kind: 'document',
      direction: 1,
      balance: { transaction: usd(100_000n), bookMinor: 12_000_000n, parallelMinor: 100_000n },
    };
    const lines = post(at('2026-11-19', [bulletin('123.0000', '2026-11-19')]), [
      { account: '532005', amount: usd(100_000n) },
      { account: '112001', dimensions: client, amount: usd(-100_000n), item },
    ]);
    expect(rows(lines)).toEqual([
      ['measured', '532005', 'USD', 100_000n, 12_300_000n, 100_000n, null],
      ['carried', '112001', 'USD', -100_000n, -12_000_000n, -100_000n, 'M-1:clear'],
      ['difference', '421001', 'SYP', -300_000n, -300_000n, 0n, null],
    ]);
  });
});

describe('opening/before-books-start: a correction against retained earnings (S10 rule 28)', () => {
  // INV-2026-88: 200.00 USD carried at the eve's 125, voided on 12 January 2027 at 126 (IAS 8.42).
  const item = (): ItemState => ({
    id: 'INV-2026-88',
    kind: 'document',
    direction: 1,
    balance: { transaction: usd(20_000n), bookMinor: 2_500_000n, parallelMinor: 20_000n },
  });
  const january = at('2027-01-12', [bulletin('126.0000', '2027-01-12')]);
  const correct = (lines: Parameters<typeof manualEntry>[0]['lines']) =>
    balanceEntry({
      on: january.on,
      ledgers: january.ledgers,
      lines: manualEntry({ lines, dealtRates: [], retainedEarnings: '312001' }, january, targets)
        .lines,
      rounding,
    });

  it('posts the residual to retained earnings, so it takes exactly what the item carried', () => {
    const lines = correct([
      { account: '112001', dimensions: client, amount: usd(-20_000n), item: item() },
      { account: '312001', amount: usd(20_000n) },
    ]);
    expect(rows(lines)).toEqual([
      ['carried', '112001', 'USD', -20_000n, -2_500_000n, -20_000n, 'INV-2026-88:clear'],
      ['measured', '312001', 'USD', 20_000n, 2_520_000n, 20_000n, null],
      ['difference', '312001', 'SYP', -20_000n, -20_000n, 0n, null],
    ]);
    const onEquity = lines.filter((line) => line.account === '312001');
    expect(onEquity.reduce((total, line) => total + line.bookMinor, 0n)).toBe(2_500_000n);
  });

  it('refuses another newly measured line beside it, naming the line', () => {
    const error = (() => {
      try {
        correct([
          { account: '112001', dimensions: client, amount: usd(-20_000n), item: item() },
          { account: '312001', amount: usd(15_000n) },
          { account: '411001', amount: usd(5_000n) },
        ]);
      } catch (thrown) {
        return thrown;
      }
      return null;
    })();
    expect(error).toMatchObject({ code: 'VALIDATION_FAILED', details: { lineNo: 3 } });
  });

  it('leaves an entry without a line on retained earnings to the realised accounts', () => {
    const lines = correct([
      { account: '112001', dimensions: client, amount: usd(-20_000n), item: item() },
      { account: '411001', amount: usd(20_000n) },
    ]);
    expect(rows(lines).at(-1)).toEqual([
      'difference',
      '421001',
      'SYP',
      -20_000n,
      -20_000n,
      0n,
      null,
    ]);
  });

  it('leaves an entry of new measurements in one currency to its rounding, as any', () => {
    const lines = correct([
      { account: '312001', amount: usd(20_000n) },
      { account: '111004', amount: usd(-20_000n) },
    ]);
    expect(lines.map((line) => line.kind)).toEqual(['measured', 'measured']);
  });
});

describe('the void of a running movement (S04 rule 13, ad-funds/running-balance)', () => {
  const target = { account: '213001', dimensions: client };
  const voidDay = (on: string, value: string) => at(on, [bulletin(value, on)]);
  const amounts = (t: bigint, book: bigint, parallel: bigint): CarriedAmounts => ({
    transaction: usd(t),
    bookMinor: book,
    parallelMinor: parallel,
  });

  it('across zero: the excess measured at the void date, the gap a realised gain', () => {
    // 1,000.00 USD deposited at 120, 300.00 spent: 700.00 at 84,000.00 SYP; the deposit voided at 123.
    const voided = {
      id: 'C1',
      target,
      before: amounts(-70_000n, -8_400_000n, -70_000n),
      reversed: amounts(100_000n, 12_000_000n, 100_000n),
    };
    const context = voidDay('2026-11-19', '123.0000');
    // As a new movement: 700.00 cleared at 8,400,000, then 300.00 × 123 = 3,690,000.
    expect(runningVoidDifference(voided, context)).toEqual(amounts(0n, 90_000n, 0n));
    // The item cleared to zero at what the exact reversal left (300.00 at 36,000.00), then the
    // excess measured anew with its rate recorded (owner, 2026-11-06), then the realised gain.
    const lines = runningVoidDifferenceLines([voided], context, targets);
    expect(rows(lines)).toEqual([
      ['carried', '213001', 'USD', -30_000n, -3_600_000n, -30_000n, 'C1:clear'],
      ['measured', '213001', 'USD', 30_000n, 3_690_000n, 30_000n, 'C1:add'],
      ['difference', '421001', 'SYP', -90_000n, -90_000n, 0n, null],
    ]);
    const added = lines[1];
    expect(added?.kind === 'measured' && added.conversions.book).toEqual({
      basis: 'policy',
      rate: bulletin('123.0000', '2026-11-19'),
    });
    expect(balanceEntry({ on: '2026-11-19', ledgers: sypUsd, lines, rounding })).toHaveLength(3);
  });

  it('against the balance: cleared at the average, the gap a realised loss; no rate read', () => {
    // 1,300.00 USD at 158,100.00 SYP; the second deposit of 700.00 at 86,100.00 voided.
    const voided = {
      id: 'C1',
      target,
      before: amounts(-130_000n, -15_810_000n, -130_000n),
      reversed: amounts(70_000n, 8_610_000n, 70_000n),
    };
    // 15,810,000 × 700 / 1,300 = 8,513,076.92 → 8,513,077 cleared; 96,923 more credit.
    const lines = runningVoidDifferenceLines([voided], at('2026-11-25', []), targets);
    expect(rows(lines)).toEqual([
      ['difference', '213001', 'USD', 0n, -96_923n, 0n, 'C1:difference'],
      ['difference', '541001', 'SYP', 96_923n, 96_923n, 0n, null],
    ]);
    expect(balanceEntry({ on: '2026-11-25', ledgers: sypUsd, lines, rounding })).toHaveLength(2);
  });

  it('with the balance or onto a zero balance: no difference entry (owner, 2026-11-06)', () => {
    const context = at('2026-11-19', []);
    // A refund of 400.00 voided while the funds hold 600.00: it runs with the balance.
    expect(
      runningVoidDifference(
        {
          id: 'C1',
          target,
          before: amounts(-60_000n, -7_200_000n, -60_000n),
          reversed: amounts(-40_000n, -4_800_000n, -40_000n),
        },
        context,
      ),
    ).toBeNull();
    expect(
      runningVoidDifference(
        {
          id: 'C1',
          target,
          before: amounts(0n, 0n, 0n),
          reversed: amounts(-40_000n, -4_800_000n, -40_000n),
        },
        context,
      ),
    ).toBeNull();
    expect(
      runningVoidDifferenceLines(
        [
          {
            id: 'C1',
            target,
            before: amounts(0n, 0n, 0n),
            reversed: negate(amounts(1n, 120n, 1n)),
          },
        ],
        context,
        targets,
      ),
    ).toEqual([]);
  });
});

describe('a reversal and its difference entry', () => {
  it("sums a reversal's movement on an item", () => {
    const lines = [
      {
        ...emptyLine('213001', 30_000n, 3_660_000n),
        item: { id: 'C1', movement: 'clear' as const },
      },
      { ...emptyLine('213001', 10_000n, 1_230_000n), item: { id: 'C1', movement: 'add' as const } },
      emptyLine('112001', -40_000n, -4_800_000n),
    ];
    expect(movementOn(lines, 'C1', 'USD', true)).toEqual({
      transaction: usd(40_000n),
      bookMinor: 4_890_000n,
      parallelMinor: 40_000n,
    });
    expect(movementOn(lines, 'C2', 'USD', false)).toEqual(emptyBalance('USD', false));
  });

  it("never reverses a void's difference entry by hand: it goes with its reversal", () => {
    const lines = runningVoidDifferenceLines(
      [
        {
          id: 'C1',
          target: { account: '213001', dimensions: client },
          before: { transaction: usd(-70_000n), bookMinor: -8_400_000n, parallelMinor: -70_000n },
          reversed: { transaction: usd(100_000n), bookMinor: 12_000_000n, parallelMinor: 100_000n },
        },
      ],
      at('2026-11-19', [bulletin('123.0000', '2026-11-19')]),
      targets,
    );
    expect(
      refusal(() =>
        manualReversalLines(
          {
            source: 'manual',
            date: '2026-11-19',
            isReversal: false,
            reversed: false,
            followsReversal: true,
            lines,
          },
          '2026-11-25',
        ),
      ),
    ).toBe('ENTRY_NOT_REVERSIBLE');
  });
});

function emptyLine(account: string, amount: bigint, book: bigint): Line {
  return {
    kind: 'carried',
    account,
    dimensions: {},
    transaction: usd(amount),
    bookMinor: book,
    parallelMinor: amount,
  };
}

describe('itemPositions (the preview\u2019s items, S04 "Screens")', () => {
  const m1Balance: CarriedAmounts = {
    transaction: money(60_000n, 'USD'),
    bookMinor: 7_200_000n,
    parallelMinor: 60_000n,
  };

  it('shows an item before and after a receipt, and a new item from zero', () => {
    const positions = itemPositions(
      [
        {
          item: null,
          currency: 'SYP',
          amountMinor: 7_440_000n,
          bookMinor: 7_440_000n,
          parallelMinor: 60_000n,
        },
        {
          item: { id: 'm1' },
          currency: 'USD',
          amountMinor: -60_000n,
          bookMinor: -7_200_000n,
          parallelMinor: -60_000n,
        },
        {
          item: { id: 'm2' },
          currency: 'USD',
          amountMinor: 10_000n,
          bookMinor: 1_200_000n,
          parallelMinor: 10_000n,
        },
        { item: null, currency: 'SYP', amountMinor: 0n, bookMinor: -240_000n, parallelMinor: 0n },
      ],
      new Map([['m1', m1Balance]]),
      true,
    );
    expect(positions).toEqual([
      {
        id: 'm1',
        isNew: false,
        before: m1Balance,
        after: { transaction: money(0n, 'USD'), bookMinor: 0n, parallelMinor: 0n },
      },
      {
        id: 'm2',
        isNew: true,
        before: emptyBalance('USD', true),
        after: {
          transaction: money(10_000n, 'USD'),
          bookMinor: 1_200_000n,
          parallelMinor: 10_000n,
        },
      },
    ]);
  });

  it('adds both lines of a split at zero to one item, without a parallel ledger too', () => {
    const before: CarriedAmounts = {
      transaction: money(-30_000n, 'USD'),
      bookMinor: -3_600_000n,
      parallelMinor: null,
    };
    const [position] = itemPositions(
      [
        {
          item: { id: 'r1' },
          currency: 'USD',
          amountMinor: 30_000n,
          bookMinor: 3_600_000n,
          parallelMinor: null,
        },
        {
          item: { id: 'r1' },
          currency: 'USD',
          amountMinor: 10_000n,
          bookMinor: 1_230_000n,
          parallelMinor: null,
        },
      ],
      new Map([['r1', before]]),
      false,
    );
    expect(position?.after).toEqual({
      transaction: money(10_000n, 'USD'),
      bookMinor: 1_230_000n,
      parallelMinor: null,
    });
  });

  it('refuses a line in another currency than its item', () => {
    expect(() =>
      itemPositions(
        [
          {
            item: { id: 'm1' },
            currency: 'SYP',
            amountMinor: -1n,
            bookMinor: -1n,
            parallelMinor: -1n,
          },
        ],
        new Map([['m1', m1Balance]]),
        true,
      ),
    ).toThrow(RangeError);
  });
});
