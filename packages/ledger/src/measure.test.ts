import { money } from '@vertex-mizan/contracts';
import { describe, expect, it } from 'vitest';
import { measure, measuredLine } from './measure.js';
import { calendar, hubRate, rate, refusal, sypOnly, sypUsd, usdSyp } from './test-fixtures.js';

const bulletin = rate('USD', 'SYP', '120.0000', 'bulletin', '2026-11-03');
const market = rate('USD', 'SYP', '125.0000', 'market', '2026-11-03');
const hub = hubRate('122.0000', '2026-11-03');

describe('measure', () => {
  it('uses an amount as is in a ledger of its own currency, with no rate', () => {
    // 100.00 USD in the USD parallel ledger needs no rate; the book converts at the bulletin.
    expect(
      measure(money(10_000n, 'USD'), {
        ledgers: sypUsd,
        on: '2026-11-03',
        calendar,
        rates: [bulletin],
      }),
    ).toEqual({
      bookMinor: 1_200_000n,
      parallelMinor: 10_000n,
      conversions: { book: { basis: 'policy', rate: bulletin }, parallel: null },
    });
  });

  it("uses the transaction's own rate where the policy accepts it and the pair matches", () => {
    // 12 200.00 SYP ÷ 122 (Hub's rate) = 100.00 USD in the parallel ledger; the SYP book as is.
    const measured = measure(money(1_220_000n, 'SYP'), {
      ledgers: sypUsd,
      on: '2026-11-03',
      calendar,
      rates: [bulletin, market],
      transactionRate: hub,
    });
    expect(measured.bookMinor).toBe(1_220_000n);
    expect(measured.parallelMinor).toBe(10_000n);
    expect(measured.conversions).toEqual({
      book: null,
      parallel: { basis: 'transaction', rate: hub },
    });
  });

  it("never uses the transaction's own rate in a ledger whose policy does not accept it", () => {
    // The SYP book converts 100.00 USD at the bulletin (120), not at Hub's 122.
    const measured = measure(money(10_000n, 'USD'), {
      ledgers: sypUsd,
      on: '2026-11-03',
      calendar,
      rates: [bulletin],
      transactionRate: hub,
    });
    expect(measured.bookMinor).toBe(1_200_000n);
    expect(measured.conversions.book).toEqual({ basis: 'policy', rate: bulletin });
    // Nor under a market policy that does not accept it: the market row (125) applies.
    const declining = {
      ...sypUsd,
      parallel: {
        currency: 'USD',
        ratePolicy: { rateType: 'market', acceptsTransactionRate: false },
      },
    } as const;
    const parallel = measure(money(1_250_000n, 'SYP'), {
      ledgers: declining,
      on: '2026-11-03',
      calendar,
      rates: [market],
      transactionRate: hub,
    });
    expect(parallel.parallelMinor).toBe(10_000n);
    expect(parallel.conversions.parallel).toEqual({ basis: 'policy', rate: market });
  });

  it('refuses a missing rate with RATE_MISSING, even when another rate exists', () => {
    // The bulletin of 2026-11-03 is not in force on 2026-11-02, and Hub's rate is not accepted.
    const context = {
      ledgers: sypUsd,
      on: '2026-11-02',
      calendar,
      rates: [bulletin],
      transactionRate: hub,
    };
    expect(() => measure(money(10_000n, 'USD'), context)).toThrow(
      expect.objectContaining({
        name: 'DomainError',
        code: 'RATE_MISSING',
        details: { ledger: 'book', rateType: 'bulletin', from: 'USD', to: 'SYP', on: '2026-11-02' },
      }),
    );
    // A market row does not stand in for a missing bulletin.
    expect(
      refusal(() =>
        measure(money(10_000n, 'USD'), {
          ledgers: sypUsd,
          on: '2026-11-03',
          calendar,
          rates: [market],
        }),
      ),
    ).toBe('RATE_MISSING');
  });

  it('crosses a third currency through the other ledger currency', () => {
    const rates = [
      rate('TRY', 'SYP', '2.9500', 'bulletin', '2026-11-05'),
      rate('TRY', 'SYP', '3.1000', 'market', '2026-11-04'),
      rate('USD', 'SYP', '125.0000', 'market', '2026-11-05'),
    ];
    // Hub's SYP-per-USD rate does not quote TRY: the parallel ledger crosses market rates.
    const measured = measure(money(123_456n, 'TRY'), {
      ledgers: sypUsd,
      on: '2026-11-05',
      rates,
      calendar,
      transactionRate: hubRate('124.0000', '2026-11-05'),
    });
    // Book: 1 234.56 TRY × 2.95 = 3 641.952 SYP → 3 641.95.
    expect(measured.bookMinor).toBe(364_195n);
    // Parallel: 1 234.56 TRY × 3.1 ÷ 125 = 30.617088 USD → 30.62.
    expect(measured.parallelMinor).toBe(3_062n);
    expect(measured.conversions.parallel).toEqual({
      basis: 'policy',
      rate: { on: '2026-11-05', legs: [rates[1], rates[2]] },
    });
  });

  it('crosses in the book ledger of a USD book through its SYP parallel currency', () => {
    const tryBulletin = rate('TRY', 'SYP', '2.9500', 'bulletin', '2026-11-05');
    const dailyUsd = rate('USD', 'SYP', '120.0000', 'bulletin', '2026-11-05');
    const measured = measure(money(100_000n, 'TRY'), {
      ledgers: usdSyp,
      on: '2026-11-05',
      calendar,
      rates: [tryBulletin, dailyUsd, rate('TRY', 'SYP', '3.1000', 'market', '2026-11-04')],
    });
    // Book: 1 000.00 TRY × 2.95 ÷ 120 = 24.5833 USD → 24.58; parallel: × 3.1 = 3 100.00 SYP.
    expect(measured.bookMinor).toBe(2_458n);
    expect(measured.parallelMinor).toBe(310_000n);
    expect(measured.conversions.book).toEqual({
      basis: 'policy',
      rate: { on: '2026-11-05', legs: [tryBulletin, dailyUsd] },
    });
  });

  it('has no parallel amount, and no cross, in a company with one ledger', () => {
    const measured = measure(money(10_000n, 'USD'), {
      ledgers: sypOnly,
      on: '2026-11-03',
      calendar,
      rates: [bulletin],
    });
    expect(measured).toEqual({
      bookMinor: 1_200_000n,
      parallelMinor: null,
      conversions: { book: { basis: 'policy', rate: bulletin }, parallel: null },
    });
    const rates = [
      rate('TRY', 'USD', '0.0240', 'bulletin', '2026-11-01'),
      rate('USD', 'SYP', '120.0000', 'bulletin', '2026-11-01'),
    ];
    expect(
      refusal(() =>
        measure(money(100_000n, 'TRY'), { ledgers: sypOnly, on: '2026-11-03', rates, calendar }),
      ),
    ).toBe('RATE_MISSING');
  });
});

describe('measuredLine', () => {
  it('is a measured line with the amount, its ledger amounts and their conversions', () => {
    const line = measuredLine(
      { account: '1210', dimensions: { client: 'C1' }, amount: money(10_000n, 'USD') },
      { ledgers: sypUsd, on: '2026-11-03', calendar, rates: [bulletin] },
    );
    expect(line).toEqual({
      kind: 'measured',
      account: '1210',
      dimensions: { client: 'C1' },
      transaction: money(10_000n, 'USD'),
      bookMinor: 1_200_000n,
      parallelMinor: 10_000n,
      conversions: { book: { basis: 'policy', rate: bulletin }, parallel: null },
    });
  });
});
