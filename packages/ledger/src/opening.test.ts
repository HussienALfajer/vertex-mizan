import { type CompanyLedgers, type ExchangeRate, money } from '@vertex-mizan/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { balanceEntry, ledgerTotal } from './balance.js';
import { reverseLines } from './carried.js';
import type { Line } from './lines.js';
import { balancingLine, type OpeningRateContext, openingRecordLine } from './opening.js';
import { calendar, rate, sypOnly, sypUsd, usdSyp } from './test-fixtures.js';

// The accountant's part of `docs/scenarios/opening/opening-entry.md` (owner, 2026-11-12); Hub's
// part left with Hub (ADR 0021).
const contextOf = (ledgers: CompanyLedgers, rates: ExchangeRate[]): OpeningRateContext => ({
  ledgers,
  asOf: '2026-09-30',
  rates,
  calendar,
});

const retained = '312001';

function entryOf(context: OpeningRateContext, records: Parameters<typeof openingRecordLine>[0][]) {
  const lines: Line[] = records.map((record) => {
    const measured = openingRecordLine(record, context, []);
    if (measured.kind !== 'line') throw new Error(`A record line ${measured.kind}`);
    return measured.line;
  });
  const balancing = balancingLine(lines, context.ledgers, retained);
  return balancing === null ? lines : [...lines, balancing];
}

describe('the opening entry (S10 rules 14–19)', () => {
  it('measures a monetary line at the eve and names a rate it misses', () => {
    const rates = [rate('USD', 'SYP', '114.5000', 'bulletin', '2026-09-30')];
    const measured = openingRecordLine(
      {
        account: '111002',
        monetary: true,
        amount: money(10_000n, 'USD'),
        bookMinor: null,
        parallelMinor: null,
      },
      contextOf(sypUsd, rates),
      [],
    );
    expect(measured).toMatchObject({
      kind: 'line',
      line: { kind: 'measured', bookMinor: 1_145_000n, parallelMinor: 10_000n },
    });
    const missing: Parameters<typeof openingRecordLine>[2] = [];
    expect(
      openingRecordLine(
        {
          account: '111002',
          monetary: true,
          amount: money(10_000n, 'USD'),
          bookMinor: null,
          parallelMinor: null,
        },
        contextOf(sypUsd, []),
        missing,
      ),
    ).toEqual({ kind: 'rate_missing' });
    expect(missing).toEqual([
      { ledger: 'book', rateType: 'bulletin', from: 'USD', to: 'SYP', on: '2026-09-30' },
    ]);
  });

  it('refuses a stated line missing an amount, and takes the amount itself in its own currency', () => {
    const context = contextOf(sypUsd, []);
    const stated = {
      account: '121001',
      monetary: false,
      amount: money(100n, 'SYP'),
      bookMinor: null,
      parallelMinor: null,
    };
    expect(openingRecordLine(stated, context, [])).toEqual({
      kind: 'incomplete',
      ledger: 'parallel',
    });
    expect(
      openingRecordLine({ ...stated, bookMinor: 99n, parallelMinor: 1n }, context, []),
    ).toEqual({
      kind: 'incomplete',
      ledger: 'book',
    });
    expect(
      openingRecordLine({ ...stated, parallelMinor: 1n }, contextOf(sypOnly, []), []),
    ).toMatchObject({
      kind: 'line',
      line: { bookMinor: 100n, parallelMinor: null },
    });
  });

  it('posts no balancing line when the records balance', () => {
    const lines: Line[] = [
      {
        kind: 'stated',
        account: 'a',
        dimensions: {},
        transaction: money(5n, 'USD'),
        bookMinor: 5n,
        parallelMinor: 600n,
      },
      {
        kind: 'stated',
        account: 'b',
        dimensions: {},
        transaction: money(-5n, 'USD'),
        bookMinor: -5n,
        parallelMinor: -600n,
      },
    ];
    expect(balancingLine(lines, usdSyp, 'r')).toBeNull();
    expect(balancingLine(lines.slice(0, 1), usdSyp, 'r')).toMatchObject({
      transaction: money(-5n, 'USD'),
      parallelMinor: -600n,
    });
  });
});

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
// A bulletin and a market rate every day, so any line is measured.
const generatedRates: ExchangeRate[] = [];
for (let day = '2026-09-01'; day <= '2026-09-30'; day = addDays(day, 1)) {
  generatedRates.push(rate('USD', 'SYP', '114.5000', 'bulletin', day));
  generatedRates.push(rate('USD', 'SYP', '117.2500', 'market', day));
}

describe('opening properties', () => {
  it('balances in every ledger for any lines, the balancing line the only remainder, netting to zero with its reversal', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            monetary: fc.boolean(),
            currency: fc.constantFrom('USD' as const, 'SYP' as const),
            amount: fc
              .bigInt({ min: -1_000_000_000n, max: 1_000_000_000n })
              .filter((amount) => amount !== 0n),
            other: fc.bigInt({ min: -10_000_000n, max: 10_000_000n }),
          }),
          { maxLength: 5 },
        ),
        fc.constantFrom(sypUsd, usdSyp, sypOnly),
        (records, ledgers) => {
          const lines = entryOf(
            contextOf(ledgers, generatedRates),
            records.map((record, k) => ({
              account: `R${k}`,
              monetary: record.monetary,
              amount: money(record.amount, record.currency),
              bookMinor: record.currency === ledgers.book.currency ? null : record.other,
              parallelMinor:
                ledgers.parallel === null || record.currency === ledgers.parallel.currency
                  ? null
                  : record.other,
            })),
          );
          if (lines.length < 2) return;
          const posted = balanceEntry({
            on: '2026-10-01',
            ledgers,
            lines,
            rounding: { account: 'X' },
          });
          expect(posted).toHaveLength(lines.length);
          expect(ledgerTotal(posted, 'book')).toBe(0n);
          if (ledgers.parallel !== null) expect(ledgerTotal(posted, 'parallel')).toBe(0n);
          const others = lines.filter((line) => line.account !== retained);
          const balancing = balancingLine(others, ledgers, retained);
          expect(lines.length - others.length).toBe(balancing === null ? 0 : 1);
          const reversed = [...posted, ...reverseLines(posted)];
          expect(ledgerTotal(reversed, 'book')).toBe(0n);
          if (ledgers.parallel !== null) expect(ledgerTotal(reversed, 'parallel')).toBe(0n);
          for (const account of new Set(posted.map((line) => line.account))) {
            const own = reversed.filter((line) => line.account === account);
            expect(own.reduce((sum, line) => sum + line.transaction.amountMinor, 0n)).toBe(0n);
          }
        },
      ),
    );
  });
});
