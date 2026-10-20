import { money } from '@vertex-mizan/contracts';
import { describe, expect, it } from 'vitest';
import { balanceEntry, differenceLine, exchangeDifferenceLines, ledgerTotal } from './balance.js';
import { clearOpenItem } from './carried.js';
import { carriedLine, type Line } from './lines.js';
import { type MeasureContext, measuredLine } from './measure.js';
import { rate, refusal, sypOnly, sypUsd } from './test-fixtures.js';

const rounding = { account: '5920' };
const gainOrLoss = { account: '5910' };

function invoice(context: MeasureContext, amounts: readonly bigint[], currency: 'USD' | 'TRY') {
  const total = amounts.reduce((sum, amount) => sum + amount, 0n);
  return [
    measuredLine({ account: '1210', amount: money(total, currency) }, context),
    ...amounts.map((amount) =>
      measuredLine({ account: '4110', amount: money(-amount, currency) }, context),
    ),
  ];
}

describe('balanceEntry', () => {
  const usdBulletin = {
    ledgers: sypUsd,
    on: '2026-11-03',
    rates: [rate('USD', 'SYP', '121.5000', 'bulletin', '2026-11-03')],
  };

  it('passes a balanced entry through unchanged', () => {
    const lines = invoice(usdBulletin, [10_000n], 'USD');
    expect(balanceEntry({ on: '2026-11-03', ledgers: sypUsd, lines, rounding })).toEqual(lines);
  });

  it('adds a rounding line, in that ledger only, for conversion rounding', () => {
    // 100.00 USD in 33.33 + 33.33 + 33.34 at 121.5: 12 150.00 SYP against 4 049.595 → 4 049.60
    // twice and 4 050.81, so the book is 0.01 SYP short; the USD parallel balances as is.
    const lines = invoice(usdBulletin, [3_333n, 3_333n, 3_334n], 'USD');
    expect(lines.map((line) => line.bookMinor)).toEqual([
      1_215_000n,
      -404_960n,
      -404_960n,
      -405_081n,
    ]);
    const balanced = balanceEntry({ on: '2026-11-03', ledgers: sypUsd, lines, rounding });
    expect(balanced.slice(0, 4)).toEqual(lines);
    expect(balanced.slice(4)).toEqual([
      {
        kind: 'rounding',
        ledger: 'book',
        account: '5920',
        dimensions: {},
        transaction: money(1n, 'SYP'),
        bookMinor: 1n,
        parallelMinor: 0n,
      },
    ]);
    expect(ledgerTotal(balanced, 'book')).toBe(0n);
    expect(ledgerTotal(balanced, 'parallel')).toBe(0n);
  });

  it('refuses an exchange residual its posting rule did not post', () => {
    // A 100.00 USD receivable at 120 settled by cash at 123, with no difference line.
    const item = {
      transaction: money(10_000n, 'USD'),
      bookMinor: 1_200_000n,
      parallelMinor: 10_000n,
    };
    const lines = [
      measuredLine(
        { account: '1121', amount: money(10_000n, 'USD') },
        {
          ledgers: sypUsd,
          on: '2026-11-20',
          rates: [rate('USD', 'SYP', '123.0000', 'bulletin', '2026-11-20')],
        },
      ),
      carriedLine({
        account: '1210',
        amounts: clearOpenItem({ measured: item, openMinor: 10_000n }, -10_000n),
      }),
    ];
    expect(() => balanceEntry({ on: '2026-11-20', ledgers: sypUsd, lines, rounding })).toThrow(
      expect.objectContaining({
        code: 'ENTRY_UNBALANCED',
        details: { ledger: 'book', residualMinor: '-30000' },
      }),
    );
  });

  it('refuses lines that do not balance, however small the residual', () => {
    // 0.01 USD more debit than credit is refused, never taken for rounding.
    const lines = [
      measuredLine({ account: '1210', amount: money(3n, 'USD') }, usdBulletin),
      measuredLine({ account: '4110', amount: money(-2n, 'USD') }, usdBulletin),
    ];
    expect(() => balanceEntry({ on: '2026-11-03', ledgers: sypUsd, lines, rounding })).toThrow(
      expect.objectContaining({ code: 'ENTRY_UNBALANCED' }),
    );
  });

  it('refuses fewer than two lines and SYP amounts before the new pound', () => {
    const one = invoice(usdBulletin, [10_000n], 'USD').slice(0, 1);
    expect(
      refusal(() => balanceEntry({ on: '2026-11-03', ledgers: sypUsd, lines: one, rounding })),
    ).toBe('ENTRY_TOO_FEW_LINES');
    const lines = invoice(usdBulletin, [10_000n], 'USD');
    // The SYP book makes every amount of the entry an SYP amount.
    expect(
      refusal(() => balanceEntry({ on: '2025-12-31', ledgers: sypUsd, lines, rounding })),
    ).toBe('SYP_BEFORE_REDENOMINATION');
  });

  it('refuses lines whose amounts contradict their kind', () => {
    const [receivable, revenue] = invoice(usdBulletin, [10_000n], 'USD') as [Line, Line];
    const check =
      (lines: Line[], ledgers = sypUsd) =>
      () =>
        balanceEntry({ on: '2026-11-03', ledgers, lines, rounding });
    // A measured amount that is not the conversion it records.
    expect(
      check([
        { ...receivable, bookMinor: 1_215_001n },
        { ...revenue, bookMinor: -1_215_001n },
      ]),
    ).toThrow(TypeError);
    // An amount in its own currency that differs from the transaction amount.
    expect(
      check([
        { ...receivable, parallelMinor: 10_001n },
        { ...revenue, parallelMinor: -10_001n },
      ]),
    ).toThrow(TypeError);
    // A parallel amount in a company that keeps no parallel ledger.
    expect(check([receivable, revenue], sypOnly)).toThrow(TypeError);
    // A difference line with amounts in two ledgers.
    const both = {
      ...differenceLine(sypUsd, 'book', 100n, { kind: 'gain-loss', ...gainOrLoss }),
      parallelMinor: 1n,
    };
    expect(check([receivable, revenue, both])).toThrow(TypeError);
  });
});

describe('difference lines', () => {
  it('on the gain or loss account are in the ledger currency, in that ledger only', () => {
    expect(differenceLine(sypUsd, 'parallel', 240n, { kind: 'gain-loss', ...gainOrLoss })).toEqual({
      kind: 'difference',
      ledger: 'parallel',
      account: '5910',
      dimensions: {},
      transaction: money(240n, 'USD'),
      bookMinor: 0n,
      parallelMinor: 240n,
    });
    expect(
      differenceLine(sypOnly, 'book', -30_000n, { kind: 'gain-loss', ...gainOrLoss }),
    ).toMatchObject({
      transaction: money(-30_000n, 'SYP'),
      bookMinor: -30_000n,
      parallelMinor: null,
    });
  });

  it("on an item keep the item's currency with no transaction amount", () => {
    expect(
      differenceLine(sypUsd, 'book', 25_000n, {
        kind: 'item',
        account: '2210',
        dimensions: { client: 'C1' },
        currency: 'USD',
      }),
    ).toEqual({
      kind: 'difference',
      ledger: 'book',
      account: '2210',
      dimensions: { client: 'C1' },
      transaction: money(0n, 'USD'),
      bookMinor: 25_000n,
      parallelMinor: 0n,
    });
    // A USD item has no exchange difference in the USD ledger, and there is no parallel ledger
    // in a company that keeps one ledger.
    expect(() =>
      differenceLine(sypUsd, 'parallel', 1n, { kind: 'item', account: '2210', currency: 'USD' }),
    ).toThrow(TypeError);
    expect(() =>
      differenceLine(sypOnly, 'parallel', 1n, { kind: 'gain-loss', ...gainOrLoss }),
    ).toThrow(TypeError);
  });

  it('balance a settlement in each ledger it leaves out of balance', () => {
    // A 1 234.56 TRY receivable carried at 3 641.95 SYP and 30.62 USD, paid in TRY on 2026-11-20:
    // book 1 234.56 × 3 = 3 703.68 SYP; parallel 1 234.56 × 3.2 ÷ 126 = 31.3539… → 31.35 USD.
    const item = {
      transaction: money(123_456n, 'TRY'),
      bookMinor: 364_195n,
      parallelMinor: 3_062n,
    };
    const context = {
      ledgers: sypUsd,
      on: '2026-11-20',
      rates: [
        rate('TRY', 'SYP', '3.0000', 'bulletin', '2026-11-20'),
        rate('TRY', 'SYP', '3.2000', 'market', '2026-11-20'),
        rate('USD', 'SYP', '126.0000', 'market', '2026-11-20'),
      ],
    };
    const lines = [
      measuredLine({ account: '1112', amount: money(123_456n, 'TRY') }, context),
      carriedLine({
        account: '1210',
        amounts: clearOpenItem({ measured: item, openMinor: 123_456n }, -123_456n),
      }),
    ];
    const differences = exchangeDifferenceLines(sypUsd, lines, gainOrLoss);
    // Gains: 61.73 SYP in the book ledger, 0.73 USD in the parallel ledger.
    expect(
      differences.map((line) => [line.transaction, line.bookMinor, line.parallelMinor]),
    ).toEqual([
      [money(-6_173n, 'SYP'), -6_173n, 0n],
      [money(-73n, 'USD'), 0n, -73n],
    ]);
    const balanced = balanceEntry({
      on: '2026-11-20',
      ledgers: sypUsd,
      lines: [...lines, ...differences],
      rounding,
    });
    expect(balanced).toHaveLength(4);
  });
});
