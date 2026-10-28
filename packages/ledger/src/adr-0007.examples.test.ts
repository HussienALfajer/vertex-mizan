import { type CompanyLedgers, type ExchangeRate, type Money, money } from '@vertex-mizan/contracts';
import { describe, expect, it } from 'vitest';
import { balanceEntry, exchangeDifferenceLines, ledgerTotal } from './balance.js';
import {
  clearOpenItem,
  moveRunningBalance,
  openItemCarrying,
  type RunningMovement,
  reverseLines,
} from './carried.js';
import { type CarriedAmounts, carriedLine, type Line, negate } from './lines.js';
import { manualEntryLines } from './manual.js';
import { type MeasureContext, measuredLine } from './measure.js';
import { calendar, hubRate, rate, refusal, sypOnly, sypUsd, usdSyp } from './test-fixtures.js';

/**
 * The worked examples of ADR 0007 and `docs/scenarios/README.md`, built with the ledger's
 * mechanics. Account codes are the scenario book's placeholders: 1111 cash SYP, 1121 cash USD,
 * 1112 cash TRY, 1210 trade receivables, 2210 client ad funds held, 4110 service revenue,
 * 5910 exchange gain or loss, 5920 conversion rounding. They show the mechanics, not the posting
 * rules: each rule's entries are approved with its own scenario (S03 on).
 */

const rounding = { account: '5920' };
const gainOrLoss = { account: '5910' };

type Row = readonly [string, string, string, bigint, bigint, bigint | null];

/** A line as a row of the scenario book: kind, account, currency, amount, book, parallel. */
function rows(lines: readonly Line[]): Row[] {
  return lines.map((line) => [
    line.kind,
    line.account,
    line.transaction.currency,
    line.transaction.amountMinor,
    line.bookMinor,
    line.parallelMinor,
  ]);
}

function context(
  ledgers: CompanyLedgers,
  on: string,
  rates: readonly ExchangeRate[],
  transactionRate?: ExchangeRate,
): MeasureContext {
  return transactionRate === undefined
    ? { ledgers, on, rates, calendar }
    : { ledgers, on, rates, calendar, transactionRate };
}

/** An invoice: Dr receivable / Cr revenue, both new measurements. */
function invoice(at: MeasureContext, amount: Money): Line[] {
  return balanceEntry({
    on: at.on,
    ledgers: at.ledgers,
    lines: [
      measuredLine({ account: '1210', dimensions: { client: 'C1' }, amount }, at),
      measuredLine({ account: '4110', amount: money(-amount.amountMinor, amount.currency) }, at),
    ],
    rounding,
  });
}

/** A payment: Dr cash measured new / Cr the receivable at its carrying amounts / the difference. */
function payment(
  at: MeasureContext,
  cash: string,
  item: CarriedAmounts,
  open: bigint,
  paid: Money,
) {
  const lines = [
    measuredLine({ account: cash, amount: paid }, at),
    carriedLine({
      account: '1210',
      dimensions: { client: 'C1' },
      amounts: clearOpenItem({ measured: item, openMinor: open }, -paid.amountMinor),
    }),
  ];
  const differences = exchangeDifferenceLines(at.ledgers, lines, gainOrLoss);
  return balanceEntry({
    on: at.on,
    ledgers: at.ledgers,
    lines: [...lines, ...differences],
    rounding,
  });
}

function cleared(movement: RunningMovement): CarriedAmounts {
  if (movement.cleared === null) throw new TypeError('A movement that clears nothing');
  return movement.cleared;
}

function receivable(entry: readonly Line[]): CarriedAmounts {
  const [line] = entry;
  if (line === undefined) throw new TypeError('An invoice with no lines');
  return line;
}

describe('ADR 0007 consequences: B1 solved', () => {
  it('a USD invoice at bulletin 120 paid in USD at 123 posts a 300.00 SYP gain in the book only', () => {
    const bulletins = [
      rate('USD', 'SYP', '120.0000', 'bulletin', '2026-11-03'),
      rate('USD', 'SYP', '123.0000', 'bulletin', '2026-11-20'),
    ];
    const issued = invoice(
      context(sypUsd, '2026-11-03', bulletins, hubRate('122.0000', '2026-11-03')),
      money(10_000n, 'USD'),
    );
    // 100.00 USD × 120 = 12 000.00 SYP; USD as is in the parallel ledger (Hub's 122 not needed).
    expect(rows(issued)).toEqual([
      ['measured', '1210', 'USD', 10_000n, 1_200_000n, 10_000n],
      ['measured', '4110', 'USD', -10_000n, -1_200_000n, -10_000n],
    ]);
    const paid = payment(
      context(sypUsd, '2026-11-20', bulletins, hubRate('125.0000', '2026-11-20')),
      '1121',
      receivable(issued),
      10_000n,
      money(10_000n, 'USD'),
    );
    // Cash 100.00 × 123 = 12 300.00 SYP; the receivable cleared at 12 000.00; gain 300.00 SYP.
    expect(rows(paid)).toEqual([
      ['measured', '1121', 'USD', 10_000n, 1_230_000n, 10_000n],
      ['carried', '1210', 'USD', -10_000n, -1_200_000n, -10_000n],
      ['difference', '5910', 'SYP', -30_000n, -30_000n, 0n],
    ]);
  });
});

describe('docs/scenarios/README.md examples', () => {
  it("an SYP invoice paid in SYP at Hub's 122 then 125 posts a 2.40 USD loss in the parallel only", () => {
    const issued = invoice(
      context(sypUsd, '2026-11-03', [], hubRate('122.0000', '2026-11-03')),
      money(1_220_000n, 'SYP'),
    );
    // 12 200.00 SYP ÷ 122 = 100.00 USD.
    expect(rows(issued)).toEqual([
      ['measured', '1210', 'SYP', 1_220_000n, 1_220_000n, 10_000n],
      ['measured', '4110', 'SYP', -1_220_000n, -1_220_000n, -10_000n],
    ]);
    const paid = payment(
      context(sypUsd, '2026-11-20', [], hubRate('125.0000', '2026-11-20')),
      '1111',
      receivable(issued),
      1_220_000n,
      money(1_220_000n, 'SYP'),
    );
    // 12 200.00 SYP ÷ 125 = 97.60 USD received against 100.00 USD carried.
    expect(rows(paid)).toEqual([
      ['measured', '1111', 'SYP', 1_220_000n, 1_220_000n, 9_760n],
      ['carried', '1210', 'SYP', -1_220_000n, -1_220_000n, -10_000n],
      ['difference', '5910', 'USD', 240n, 0n, 240n],
    ]);
  });
});

describe('currency shapes', () => {
  it('syp: one ledger, no parallel amounts; the realised difference in the book', () => {
    const bulletins = [
      rate('USD', 'SYP', '120.0000', 'bulletin', '2026-11-03'),
      rate('USD', 'SYP', '123.0000', 'bulletin', '2026-11-20'),
    ];
    const issued = invoice(context(sypOnly, '2026-11-03', bulletins), money(10_000n, 'USD'));
    const paid = payment(
      context(sypOnly, '2026-11-20', bulletins),
      '1121',
      receivable(issued),
      10_000n,
      money(10_000n, 'USD'),
    );
    expect(rows(paid)).toEqual([
      ['measured', '1121', 'USD', 10_000n, 1_230_000n, null],
      ['carried', '1210', 'USD', -10_000n, -1_200_000n, null],
      ['difference', '5910', 'SYP', -30_000n, -30_000n, null],
    ]);
  });

  it('third: a TRY invoice, the book at the TRY bulletin, the parallel crossed at market', () => {
    const rates = [
      rate('TRY', 'SYP', '2.9500', 'bulletin', '2026-11-05'),
      // Effective after the entry date: not in force.
      rate('TRY', 'SYP', '2.9900', 'bulletin', '2026-11-09'),
      rate('TRY', 'SYP', '3.1000', 'market', '2026-11-04'),
      rate('USD', 'SYP', '125.0000', 'market', '2026-11-05'),
    ];
    const at = context(sypUsd, '2026-11-05', rates, hubRate('124.0000', '2026-11-05'));
    const lines = [
      measuredLine({ account: '1210', amount: money(123_456n, 'TRY') }, at),
      measuredLine({ account: '4110', amount: money(-61_728n, 'TRY') }, at),
      measuredLine({ account: '4110', amount: money(-61_728n, 'TRY') }, at),
    ];
    const entry = balanceEntry({ on: at.on, ledgers: sypUsd, lines, rounding });
    // Book: 1 234.56 × 2.95 = 3 641.952 → 3 641.95; 617.28 × 2.95 = 1 820.976 → 1 820.98 twice,
    // so the book is 0.01 SYP short: a rounding line. Parallel: × 3.1 ÷ 125 = 30.617 → 30.62 and
    // 15.3085 → 15.31 twice, balanced. Hub's SYP-per-USD rate does not quote TRY.
    expect(rows(entry)).toEqual([
      ['measured', '1210', 'TRY', 123_456n, 364_195n, 3_062n],
      ['measured', '4110', 'TRY', -61_728n, -182_098n, -1_531n],
      ['measured', '4110', 'TRY', -61_728n, -182_098n, -1_531n],
      ['rounding', '5920', 'SYP', 1n, 1n, 0n],
    ]);
    // Its reversal negates every amount and nets every account to zero in both ledgers.
    const both = [...entry, ...reverseLines(entry)];
    for (const account of ['1210', '4110', '5920']) {
      const lines = both.filter((line) => line.account === account);
      expect([ledgerTotal(lines, 'book'), ledgerTotal(lines, 'parallel')]).toEqual([0n, 0n]);
    }
  });

  it('usd-syp: a USD book crosses the TRY bulletin with the USD bulletin of the day', () => {
    // Each quote of the cross is of the entry date (ADR 0011; a weekly TRY bulletin is Q10).
    const tryBulletin = rate('TRY', 'SYP', '2.9500', 'bulletin', '2026-11-05');
    const daily = rate('USD', 'SYP', '120.0000', 'bulletin', '2026-11-05');
    const at = context(usdSyp, '2026-11-05', [
      tryBulletin,
      daily,
      rate('TRY', 'SYP', '3.1000', 'market', '2026-11-04'),
    ]);
    const entry = invoice(at, money(100_000n, 'TRY'));
    // Book: 1 000.00 TRY × 2.95 ÷ 120 = 24.583 USD → 24.58; parallel: × 3.1 = 3 100.00 SYP.
    expect(rows(entry)).toEqual([
      ['measured', '1210', 'TRY', 100_000n, 2_458n, 310_000n],
      ['measured', '4110', 'TRY', -100_000n, -2_458n, -310_000n],
    ]);
    const [line] = entry;
    expect(line?.kind === 'measured' && line.conversions.book).toEqual({
      basis: 'policy',
      rate: { on: '2026-11-05', legs: [tryBulletin, daily] },
    });
  });

  it('a missing bulletin holds the event: RATE_MISSING, never a default', () => {
    // Only the bulletin of 2026-11-05 exists; the event is dated 2026-11-04.
    const at = context(
      sypUsd,
      '2026-11-04',
      [rate('USD', 'SYP', '121.0000', 'bulletin', '2026-11-05')],
      hubRate('122.0000', '2026-11-04'),
    );
    expect(refusal(() => invoice(at, money(10_000n, 'USD')))).toBe('RATE_MISSING');
  });
});

describe('carried amounts', () => {
  it('partial settlements clear the carrying amount cumulatively; the last clears the rest', () => {
    // 100.00 USD invoiced at a bulletin of 121.3333: 12 133.33 SYP.
    const at = (on: string, bulletin: string) =>
      context(sypUsd, on, [rate('USD', 'SYP', bulletin, 'bulletin', on)]);
    const issued = invoice(at('2026-11-03', '121.3333'), money(10_000n, 'USD'));
    const item = receivable(issued);
    expect(item.bookMinor).toBe(1_213_333n);
    const first = payment(
      at('2026-11-10', '122.0000'),
      '1121',
      item,
      10_000n,
      money(3_333n, 'USD'),
    );
    const second = payment(
      at('2026-11-20', '120.0000'),
      '1121',
      item,
      6_667n,
      money(3_333n, 'USD'),
    );
    const last = payment(at('2026-11-30', '125.0000'), '1121', item, 3_334n, money(3_334n, 'USD'));
    // Cleared 404 404, 404 404 and 404 525 = 12 133.33 SYP. Cash 3 333 × 122 = 406 626 (gain
    // 22.22); 3 333 × 120 = 399 960 (loss 44.44); 3 334 × 125 = 416 750 (gain 122.25).
    expect([...rows(first), ...rows(second), ...rows(last)]).toEqual([
      ['measured', '1121', 'USD', 3_333n, 406_626n, 3_333n],
      ['carried', '1210', 'USD', -3_333n, -404_404n, -3_333n],
      ['difference', '5910', 'SYP', -2_222n, -2_222n, 0n],
      ['measured', '1121', 'USD', 3_333n, 399_960n, 3_333n],
      ['carried', '1210', 'USD', -3_333n, -404_404n, -3_333n],
      ['difference', '5910', 'SYP', 4_444n, 4_444n, 0n],
      ['measured', '1121', 'USD', 3_334n, 416_750n, 3_334n],
      ['carried', '1210', 'USD', -3_334n, -404_525n, -3_334n],
      ['difference', '5910', 'SYP', -12_225n, -12_225n, 0n],
    ]);
    // Settled in full, the receivable is zero in both ledgers.
    const lines = [...issued, ...first, ...second, ...last].filter(
      (line) => line.account === '1210',
    );
    expect([ledgerTotal(lines, 'book'), ledgerTotal(lines, 'parallel')]).toEqual([0n, 0n]);
    expect(openItemCarrying({ measured: item, openMinor: 0n }).bookMinor).toBe(0n);
  });

  it('a running balance clears at its average, crosses zero, and returns to zero in both ledgers', () => {
    const bulletin = (on: string, value: string) =>
      context(sypUsd, on, [rate('USD', 'SYP', value, 'bulletin', on)]);
    const add = (balance: CarriedAmounts, line: CarriedAmounts): CarriedAmounts => ({
      transaction: money(
        balance.transaction.amountMinor + line.transaction.amountMinor,
        balance.transaction.currency,
      ),
      bookMinor: balance.bookMinor + line.bookMinor,
      parallelMinor: (balance.parallelMinor ?? 0n) + (line.parallelMinor ?? 0n),
    });
    const measured = (at: MeasureContext, amountMinor: bigint) =>
      measuredLine({ account: '2210', amount: money(amountMinor, 'USD') }, at);
    // Deposits of 100.00 USD at 120 and 50.00 USD at 125: 15 000 USD cents, 18 250.00 SYP.
    let funds = add(
      measured(bulletin('2026-11-02', '120.0000'), -10_000n),
      measured(bulletin('2026-11-09', '125.0000'), -5_000n),
    );
    expect(funds).toEqual({
      transaction: money(-15_000n, 'USD'),
      bookMinor: -1_825_000n,
      parallelMinor: -15_000n,
    });
    // Spend 10.00 USD: cleared at the average, round(1 825 000 × 1 000 ÷ 15 000) = 121 667.
    const spend = moveRunningBalance(funds, 1_000n);
    expect(spend.cleared).toEqual({
      transaction: money(1_000n, 'USD'),
      bookMinor: 121_667n,
      parallelMinor: 1_000n,
    });
    funds = add(funds, cleared(spend));
    // Spend 150.00 USD against 140.00 USD held: 140.00 cleared at 17 033.33 SYP, the 10.00 USD
    // excess measured new at the bulletin of the day (124): the client owes 10.00 USD.
    const crossing = moveRunningBalance(funds, 15_000n);
    expect(crossing.cleared).toEqual(negate(funds));
    expect(crossing.measuredMinor).toBe(1_000n);
    funds = measured(bulletin('2026-11-23', '124.0000'), crossing.measuredMinor);
    expect([funds.bookMinor, funds.parallelMinor]).toEqual([124_000n, 1_000n]);
    // The client pays the 10.00 USD at 127: the item clears at its 1 240.00 SYP, gain 30.00 SYP.
    const settle = moveRunningBalance(funds, -1_000n);
    expect(settle).toEqual({ cleared: negate(funds), measuredMinor: 0n });
    const at = bulletin('2026-11-30', '127.0000');
    const lines = [
      measuredLine({ account: '1121', amount: money(1_000n, 'USD') }, at),
      carriedLine({ account: '2210', amounts: cleared(settle) }),
    ];
    const entry = balanceEntry({
      on: at.on,
      ledgers: sypUsd,
      lines: [...lines, ...exchangeDifferenceLines(sypUsd, lines, gainOrLoss)],
      rounding,
    });
    expect(rows(entry)).toEqual([
      ['measured', '1121', 'USD', 1_000n, 127_000n, 1_000n],
      ['carried', '2210', 'USD', -1_000n, -124_000n, -1_000n],
      ['difference', '5910', 'SYP', -3_000n, -3_000n, 0n],
    ]);
    expect(add(funds, cleared(settle))).toEqual({
      transaction: money(0n, 'USD'),
      bookMinor: 0n,
      parallelMinor: 0n,
    });
  });
});

/**
 * The cases of `docs/scenarios/currency/bulletin-rate-of-the-day.md` and
 * `rate-correction-after-use.md` (ADR 0011, S02 rules 15–16), with the service-agency template's
 * codes the scenarios use: 531001 rent, 531004 software, 531006 repairs, 532002 bank charges,
 * 111003 bank SYP, 111004 bank USD, 211003 other payables. Each is a manual entry of two lines in
 * one currency; the scenario book runs them through the posting function from S03.
 */
describe('docs/scenarios/currency: the bulletin rate of the day', () => {
  const usdSypBulletin = (on: string, value: string) => rate('USD', 'SYP', value, 'bulletin', on);

  /** Dr `debit` / Cr `credit`, both measured new on `on`. */
  function paid(at: MeasureContext, debit: string, credit: string, amount: Money): readonly Row[] {
    const lines = [
      measuredLine({ account: debit, amount }, at),
      measuredLine({ account: credit, amount: money(-amount.amountMinor, amount.currency) }, at),
    ];
    return rows(balanceEntry({ on: at.on, ledgers: at.ledgers, lines, rounding }));
  }

  const on = (
    ledgers: CompanyLedgers,
    date: string,
    rates: readonly ExchangeRate[],
    at = calendar,
  ): MeasureContext => ({ ledgers, on: date, rates, calendar: at });

  const week = [
    usdSypBulletin('2026-11-05', '120.0000'),
    usdSypBulletin('2026-11-08', '121.5000'),
    usdSypBulletin('2026-11-10', '122.2500'),
  ];
  const usd = (minor: bigint) => money(minor, 'USD');

  it('a working day takes its own bulletin, not an older or a later one', () => {
    expect(paid(on(sypUsd, '2026-11-08', week), '531004', '111004', usd(10_000n))).toEqual([
      ['measured', '531004', 'USD', 10_000n, 1_215_000n, 10_000n],
      ['measured', '111004', 'USD', -10_000n, -1_215_000n, -10_000n],
    ]);
  });

  it("Friday and Saturday take Thursday's bulletin", () => {
    const rates = week.slice(0, 2);
    expect(paid(on(sypUsd, '2026-11-06', rates), '531004', '111004', usd(10_000n))).toEqual([
      ['measured', '531004', 'USD', 10_000n, 1_200_000n, 10_000n],
      ['measured', '111004', 'USD', -10_000n, -1_200_000n, -10_000n],
    ]);
    expect(paid(on(sypUsd, '2026-11-07', rates), '532002', '111004', usd(2_550n))).toEqual([
      ['measured', '532002', 'USD', 2_550n, 306_000n, 2_550n],
      ['measured', '111004', 'USD', -2_550n, -306_000n, -2_550n],
    ]);
  });

  it("a holiday on a Sunday takes Thursday's bulletin across the weekend", () => {
    const rates = [week[0], week[2]].filter((row) => row !== undefined);
    const holiday = { daysOff: [5, 6], holidays: ['2026-11-08'] };
    expect(
      paid(on(sypUsd, '2026-11-08', rates, holiday), '531004', '111004', usd(10_000n)),
    ).toEqual([
      ['measured', '531004', 'USD', 10_000n, 1_200_000n, 10_000n],
      ['measured', '111004', 'USD', -10_000n, -1_200_000n, -10_000n],
    ]);
    // Without the holiday, the 8th is a working day with no bulletin of its own.
    expect(
      refusal(() => paid(on(sypUsd, '2026-11-08', rates), '531004', '111004', usd(10_000n))),
    ).toBe('RATE_MISSING');
  });

  it('a working day without its bulletin is refused, never converted at the day before', () => {
    const rates = week.slice(0, 2);
    expect(
      refusal(() => paid(on(sypUsd, '2026-11-09', rates), '531004', '111004', usd(10_000n))),
    ).toBe('RATE_MISSING');
  });

  it('Friday 1 January takes the bulletin of Thursday 31 December', () => {
    const rates = [usdSypBulletin('2026-12-31', '123.0000')];
    expect(paid(on(sypUsd, '2027-01-01', rates), '531004', '111004', usd(7_500n))).toEqual([
      ['measured', '531004', 'USD', 7_500n, 922_500n, 7_500n],
      ['measured', '111004', 'USD', -7_500n, -922_500n, -7_500n],
    ]);
  });

  it("USD books: Saturday takes Thursday's bulletin, Sunday its own, Monday none", () => {
    const rent = money(1_000_000n, 'SYP');
    const rates = week.slice(0, 2);
    // 10,000.00 SYP / 120 = 83.333… → 83.33 USD; / 121.5 = 82.304… → 82.30 USD.
    expect(paid(on(usdSyp, '2026-11-07', rates), '531001', '111003', rent)).toEqual([
      ['measured', '531001', 'SYP', 1_000_000n, 8_333n, 1_000_000n],
      ['measured', '111003', 'SYP', -1_000_000n, -8_333n, -1_000_000n],
    ]);
    expect(paid(on(usdSyp, '2026-11-08', rates), '531001', '111003', rent)).toEqual([
      ['measured', '531001', 'SYP', 1_000_000n, 8_230n, 1_000_000n],
      ['measured', '111003', 'SYP', -1_000_000n, -8_230n, -1_000_000n],
    ]);
    expect(
      refusal(() => paid(on(usdSyp, '2026-11-08', week.slice(0, 1)), '531001', '111003', rent)),
    ).toBe('RATE_MISSING');
  });

  it('third: a TRY expense crosses through USD when both quotes are of the day', () => {
    const tryLeg = rate('USD', 'TRY', '41.0000', 'bulletin', '2026-11-10');
    const rates = [
      rate('TRY', 'SYP', '2.9000', 'bulletin', '2026-11-05'),
      tryLeg,
      rate('USD', 'SYP', '122.0000', 'bulletin', '2026-11-10'),
      rate('USD', 'TRY', '41.2000', 'market', '2026-11-10'),
    ];
    const repair = money(410_000n, 'TRY');
    // Book: 4,100.00 TRY / 41 × 122 = 12,200.00 SYP; parallel: / 41.2 = 99.514… → 99.51 USD.
    expect(paid(on(sypUsd, '2026-11-10', rates), '531006', '211003', repair)).toEqual([
      ['measured', '531006', 'TRY', 410_000n, 1_220_000n, 9_951n],
      ['measured', '211003', 'TRY', -410_000n, -1_220_000n, -9_951n],
    ]);
    // One quote of the 8th: neither the direct rate nor the cross is in force.
    const stale = [
      rate('TRY', 'SYP', '2.9500', 'bulletin', '2026-11-08'),
      tryLeg,
      rate('USD', 'SYP', '121.5000', 'bulletin', '2026-11-08'),
      rate('USD', 'TRY', '41.2000', 'market', '2026-11-10'),
    ];
    expect(refusal(() => paid(on(sypUsd, '2026-11-10', stale), '531006', '211003', repair))).toBe(
      'RATE_MISSING',
    );
  });

  it('a corrected bulletin leaves the posted entry; the reversal carries it, the repost converts anew', () => {
    const mistyped = usdSypBulletin('2026-11-08', '112.5000');
    const subscription = (rates: readonly ExchangeRate[]) =>
      balanceEntry({
        on: '2026-11-08',
        ledgers: sypUsd,
        lines: [
          measuredLine(
            { account: '531004', amount: usd(10_000n) },
            on(sypUsd, '2026-11-08', rates),
          ),
          measuredLine(
            { account: '111004', amount: usd(-10_000n) },
            on(sypUsd, '2026-11-08', rates),
          ),
        ],
        rounding,
      });
    const first = subscription([mistyped]);
    // The correction is a newer row of the same date, recorded last (rule 15).
    const corrected = [mistyped, usdSypBulletin('2026-11-08', '121.5000')];
    expect(rows(first)).toEqual([
      ['measured', '531004', 'USD', 10_000n, 1_125_000n, 10_000n],
      ['measured', '111004', 'USD', -10_000n, -1_125_000n, -10_000n],
    ]);
    expect(paid(on(sypUsd, '2026-11-08', corrected), '532002', '111004', usd(5_000n))).toEqual([
      ['measured', '532002', 'USD', 5_000n, 607_500n, 5_000n],
      ['measured', '111004', 'USD', -5_000n, -607_500n, -5_000n],
    ]);
    expect(rows(reverseLines(first))).toEqual([
      ['measured', '531004', 'USD', -10_000n, -1_125_000n, -10_000n],
      ['measured', '111004', 'USD', 10_000n, 1_125_000n, 10_000n],
    ]);
    expect(rows(subscription(corrected))).toEqual([
      ['measured', '531004', 'USD', 10_000n, 1_215_000n, 10_000n],
      ['measured', '111004', 'USD', -10_000n, -1_215_000n, -10_000n],
    ]);
  });

  it("a day off converted at Thursday's superseded row; Saturday takes the correction", () => {
    const wrong = usdSypBulletin('2026-11-05', '102.0000');
    const right = usdSypBulletin('2026-11-05', '120.0000');
    expect(paid(on(sypUsd, '2026-11-06', [wrong]), '531004', '111004', usd(10_000n))).toEqual([
      ['measured', '531004', 'USD', 10_000n, 1_020_000n, 10_000n],
      ['measured', '111004', 'USD', -10_000n, -1_020_000n, -10_000n],
    ]);
    expect(
      paid(on(sypUsd, '2026-11-07', [wrong, right]), '531004', '111004', usd(10_000n)),
    ).toEqual([
      ['measured', '531004', 'USD', 10_000n, 1_200_000n, 10_000n],
      ['measured', '111004', 'USD', -10_000n, -1_200_000n, -10_000n],
    ]);
  });

  it('USD books: the reversal carries 98.04, the repost 83.33', () => {
    const wrong = usdSypBulletin('2026-11-05', '102.0000');
    const right = usdSypBulletin('2026-11-05', '120.0000');
    const rent = (rates: readonly ExchangeRate[]) =>
      balanceEntry({
        on: '2026-11-05',
        ledgers: usdSyp,
        lines: [
          measuredLine(
            { account: '531001', amount: money(1_000_000n, 'SYP') },
            on(usdSyp, '2026-11-05', rates),
          ),
          measuredLine(
            { account: '111003', amount: money(-1_000_000n, 'SYP') },
            on(usdSyp, '2026-11-05', rates),
          ),
        ],
        rounding,
      });
    const first = rent([wrong]);
    // 10,000.00 SYP / 102 = 98.039… → 98.04 USD.
    expect(rows(first)).toEqual([
      ['measured', '531001', 'SYP', 1_000_000n, 9_804n, 1_000_000n],
      ['measured', '111003', 'SYP', -1_000_000n, -9_804n, -1_000_000n],
    ]);
    expect(rows(reverseLines(first))).toEqual([
      ['measured', '531001', 'SYP', -1_000_000n, -9_804n, -1_000_000n],
      ['measured', '111003', 'SYP', 1_000_000n, 9_804n, 1_000_000n],
    ]);
    expect(rows(rent([wrong, right]))).toEqual([
      ['measured', '531001', 'SYP', 1_000_000n, 8_333n, 1_000_000n],
      ['measured', '111003', 'SYP', -1_000_000n, -8_333n, -1_000_000n],
    ]);
  });
});

describe('docs/scenarios/manual: a currency purchase or sale', () => {
  const realised = { gain: { account: '421001' }, loss: { account: '541001' } };
  const roundingAccount = { account: '541003' };
  const usd = (minor: bigint) => money(minor, 'USD');
  const syp = (minor: bigint) => money(minor, 'SYP');
  const week = [
    rate('USD', 'SYP', '121.5000', 'bulletin', '2026-11-08'),
    rate('USD', 'SYP', '122.0000', 'market', '2026-11-08'),
  ];
  const dealt = (base: 'USD', quote: 'SYP' | 'TRY', value: string, on: string) =>
    rate(base, quote, value, 'market', on);
  /** `usd-syp` whose SYP parallel ledger does not accept a transaction's rate. */
  const usdSypStrict: CompanyLedgers = {
    book: usdSyp.book,
    parallel: {
      currency: 'SYP',
      ratePolicy: { rateType: 'market', acceptsTransactionRate: false },
    },
  };

  /** The manual entry `debit` / `credit` on `on`, with its rounding lines: rows of the book. */
  function exchanged(
    ledgers: CompanyLedgers,
    on: string,
    rates: readonly ExchangeRate[],
    lines: readonly [string, Money][],
    dealtRates: readonly ExchangeRate[] = [],
  ): Line[] {
    const at: MeasureContext = { ledgers, on, rates, calendar };
    const entry = manualEntryLines(
      { lines: lines.map(([account, amount]) => ({ account, amount })), dealtRates },
      at,
      realised,
    );
    const balanced = balanceEntry({ on, ledgers, lines: entry, rounding: roundingAccount });
    // In more than one currency the residual is all difference: never a rounding line too.
    expect(balanced).toEqual(entry);
    return balanced;
  }

  const purchase = (sypMinor: bigint): readonly [string, Money][] => [
    ['111004', usd(10_000n)],
    ['111003', syp(-sypMinor)],
  ];

  it('USD bought at a dealt rate: a book loss only', () => {
    const entry = exchanged(sypUsd, '2026-11-08', week, purchase(1_225_000n), [
      dealt('USD', 'SYP', '122.5000', '2026-11-08'),
    ]);
    expect(rows(entry)).toEqual([
      ['measured', '111004', 'USD', 10_000n, 1_215_000n, 10_000n],
      ['measured', '111003', 'SYP', -1_225_000n, -1_225_000n, -10_000n],
      ['difference', '541001', 'SYP', 10_000n, 10_000n, 0n],
    ]);
  });

  it('USD bought without a dealt rate: a loss in both ledgers', () => {
    // Parallel: 12,250.00 SYP / 122 = 100.4098… → 100.41 USD.
    expect(rows(exchanged(sypUsd, '2026-11-08', week, purchase(1_225_000n)))).toEqual([
      ['measured', '111004', 'USD', 10_000n, 1_215_000n, 10_000n],
      ['measured', '111003', 'SYP', -1_225_000n, -1_225_000n, -10_041n],
      ['difference', '541001', 'SYP', 10_000n, 10_000n, 0n],
      ['difference', '541001', 'USD', 41n, 0n, 41n],
    ]);
  });

  it('USD sold at a dealt rate: a book gain only', () => {
    const sale: [string, Money][] = [
      ['111003', syp(1_230_000n)],
      ['111004', usd(-10_000n)],
    ];
    const entry = exchanged(sypUsd, '2026-11-08', week, sale, [
      dealt('USD', 'SYP', '123.0000', '2026-11-08'),
    ]);
    expect(rows(entry)).toEqual([
      ['measured', '111003', 'SYP', 1_230_000n, 1_230_000n, 10_000n],
      ['measured', '111004', 'USD', -10_000n, -1_215_000n, -10_000n],
      ['difference', '421001', 'SYP', -15_000n, -15_000n, 0n],
    ]);
  });

  it('a loss in the book ledger and a gain in the parallel one', () => {
    // Parallel: 12,180.00 SYP / 122 = 99.836… → 99.84 USD.
    expect(rows(exchanged(sypUsd, '2026-11-08', week, purchase(1_218_000n)))).toEqual([
      ['measured', '111004', 'USD', 10_000n, 1_215_000n, 10_000n],
      ['measured', '111003', 'SYP', -1_218_000n, -1_218_000n, -9_984n],
      ['difference', '541001', 'SYP', 3_000n, 3_000n, 0n],
      ['difference', '421001', 'USD', -16n, 0n, -16n],
    ]);
  });

  it('the purchase reversed the next month carries every line, the difference included', () => {
    const entry = exchanged(sypUsd, '2026-11-08', week, purchase(1_225_000n), [
      dealt('USD', 'SYP', '122.5000', '2026-11-08'),
    ]);
    const reversal = reverseLines(entry);
    expect(
      balanceEntry({
        on: '2026-12-01',
        ledgers: sypUsd,
        lines: reversal,
        rounding: roundingAccount,
      }),
    ).toEqual(reversal);
    expect(rows(reversal)).toEqual([
      ['measured', '111004', 'USD', -10_000n, -1_215_000n, -10_000n],
      ['measured', '111003', 'SYP', 1_225_000n, 1_225_000n, 10_000n],
      ['difference', '541001', 'SYP', -10_000n, -10_000n, 0n],
    ]);
  });

  it('SYP books only: a loss in the books; a dealt rate is refused', () => {
    const bulletin = week.slice(0, 1);
    expect(rows(exchanged(sypOnly, '2026-11-08', bulletin, purchase(1_225_000n)))).toEqual([
      ['measured', '111004', 'USD', 10_000n, 1_215_000n, null],
      ['measured', '111003', 'SYP', -1_225_000n, -1_225_000n, null],
      ['difference', '541001', 'SYP', 10_000n, 10_000n, null],
    ]);
    expect(
      refusal(() =>
        exchanged(sypOnly, '2026-11-08', bulletin, purchase(1_225_000n), [
          dealt('USD', 'SYP', '122.5000', '2026-11-08'),
        ]),
      ),
    ).toBe('DEALT_RATE_NOT_ACCEPTED');
  });

  it('USD books: a loss in both ledgers; a dealt rate only where the parallel ledger accepts it', () => {
    // Book: 12,250.00 SYP / 121.5 = 100.823… → 100.82 USD.
    // Parallel: 100.00 USD × 122 = 12,200.00 SYP.
    expect(rows(exchanged(usdSypStrict, '2026-11-08', week, purchase(1_225_000n)))).toEqual([
      ['measured', '111004', 'USD', 10_000n, 10_000n, 1_220_000n],
      ['measured', '111003', 'SYP', -1_225_000n, -10_082n, -1_225_000n],
      ['difference', '541001', 'USD', 82n, 82n, 0n],
      ['difference', '541001', 'SYP', 5_000n, 0n, 5_000n],
    ]);
    const atDealt = [dealt('USD', 'SYP', '122.5000', '2026-11-08')];
    expect(
      refusal(() => exchanged(usdSypStrict, '2026-11-08', week, purchase(1_225_000n), atDealt)),
    ).toBe('DEALT_RATE_NOT_ACCEPTED');
    expect(rows(exchanged(usdSyp, '2026-11-08', week, purchase(1_225_000n), atDealt))).toEqual([
      ['measured', '111004', 'USD', 10_000n, 10_000n, 1_225_000n],
      ['measured', '111003', 'SYP', -1_225_000n, -10_082n, -1_225_000n],
      ['difference', '541001', 'USD', 82n, 82n, 0n],
    ]);
  });

  it('third: TRY sold for USD, at the market rate and at a dealt rate', () => {
    const rates = [
      rate('USD', 'SYP', '122.0000', 'bulletin', '2026-11-10'),
      rate('USD', 'TRY', '41.0000', 'bulletin', '2026-11-10'),
      rate('USD', 'TRY', '41.2000', 'market', '2026-11-10'),
    ];
    const sale: [string, Money][] = [
      ['111004', usd(10_000n)],
      ['111007', money(-415_000n, 'TRY')],
    ];
    // Book: 4,150.00 TRY / 41 × 122 = 12,348.780… → 12,348.78 SYP.
    // Parallel: 4,150.00 TRY / 41.2 = 100.728… → 100.73 USD.
    expect(rows(exchanged(sypUsd, '2026-11-10', rates, sale))).toEqual([
      ['measured', '111004', 'USD', 10_000n, 1_220_000n, 10_000n],
      ['measured', '111007', 'TRY', -415_000n, -1_234_878n, -10_073n],
      ['difference', '541001', 'SYP', 14_878n, 14_878n, 0n],
      ['difference', '541001', 'USD', 73n, 0n, 73n],
    ]);
    const atDealt = [dealt('USD', 'TRY', '41.5000', '2026-11-10')];
    expect(rows(exchanged(sypUsd, '2026-11-10', rates, sale, atDealt))).toEqual([
      ['measured', '111004', 'USD', 10_000n, 1_220_000n, 10_000n],
      ['measured', '111007', 'TRY', -415_000n, -1_234_878n, -10_000n],
      ['difference', '541001', 'SYP', 14_878n, 14_878n, 0n],
    ]);
  });
});
