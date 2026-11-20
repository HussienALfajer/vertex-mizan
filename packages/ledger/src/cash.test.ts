import { type CompanyLedgers, type CurrencyCode, money } from '@vertex-mizan/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { balanceEntry, ledgerTotal } from './balance.js';
import { reverseLines } from './carried.js';
import {
  balanceAtEnd,
  checkVoucherShape,
  countLines,
  derivedDealtRate,
  type TransferAmounts,
  type VoucherAccount,
  type VoucherInput,
  type VoucherLine,
} from './cash.js';
import { keptLedgers, ledgerAmount } from './lines.js';
import { manualEntryLines } from './manual.js';
import { calendar, rate, refusal } from './test-fixtures.js';

// S11 rules 8 and 10–13, with the numbers of `cash/transfer-and-exchange`, `cash/cash-count` and
// `cash/receipt-and-payment`. Every amount and rate is synthetic.

const account = (
  id: string,
  cashKind: VoucherAccount['cashKind'],
  currency: CurrencyCode | null,
): VoucherAccount => ({ id, cashKind, currency, accountClass: Number(id[0]) });

const usdBox = account('111002', 'box', 'USD');
const tryBox = account('111005', 'box', 'TRY');
const usdBank = account('111004', 'bank', 'USD');
const owner = account('313001', null, null);
const fees = account('532002', null, null);
const accounts = new Map([usdBox, tryBox, usdBank, owner, fees].map((a) => [a.id, a]));

const line = (accountId: string, currency: CurrencyCode, amountMinor: bigint): VoucherLine => ({
  account: accountId,
  currency,
  amountMinor,
});

function voucher(
  input: Partial<VoucherInput> & Pick<VoucherInput, 'kind' | 'lines'>,
): VoucherInput {
  return { cashAccount: usdBox, counterCashAccount: null, accounts, ...input };
}

describe('the shape of a voucher (S11 rules 10–13)', () => {
  it('takes a receipt with one debit on its cash account and its counter lines', () => {
    const receipt = voucher({
      kind: 'receipt',
      lines: [line('111002', 'USD', 200000n), line('313001', 'USD', -200000n)],
    });
    expect(checkVoucherShape(receipt)).toBeNull();
  });

  it('refuses a receipt with a credit, or two lines, on its cash account', () => {
    expect(
      refusal(() =>
        checkVoucherShape(
          voucher({
            kind: 'receipt',
            lines: [line('111002', 'USD', -100n), line('313001', 'USD', 100n)],
          }),
        ),
      ),
    ).toBe('CASH_ACCOUNT_INVALID');
    expect(
      refusal(() =>
        checkVoucherShape(
          voucher({
            kind: 'receipt',
            lines: [
              line('111002', 'USD', 100n),
              line('111002', 'USD', 100n),
              line('313001', 'USD', -200n),
            ],
          }),
        ),
      ),
    ).toBe('CASH_ACCOUNT_INVALID');
  });

  it('takes a payment with one credit on its cash account and refuses a debit there', () => {
    const lines = [line('531005', 'USD', 5000n), line('111002', 'USD', -5000n)];
    expect(checkVoucherShape(voucher({ kind: 'payment', lines }))).toBeNull();
    expect(
      refusal(() =>
        checkVoucherShape(
          voucher({
            kind: 'payment',
            lines: [line('111002', 'USD', 5000n), line('313001', 'USD', -5000n)],
          }),
        ),
      ),
    ).toBe('CASH_ACCOUNT_INVALID');
  });

  it('refuses a voucher on an account that is not a cash account', () => {
    expect(
      refusal(() =>
        checkVoucherShape(
          voucher({
            kind: 'receipt',
            cashAccount: owner,
            lines: [line('313001', 'USD', 100n), line('111002', 'USD', -100n)],
          }),
        ),
      ),
    ).toBe('CASH_ACCOUNT_INVALID');
  });

  it("returns a transfer's amounts with its fee (the scenario's exchange)", () => {
    const exchange = voucher({
      kind: 'transfer',
      counterCashAccount: tryBox,
      lines: [
        line('111002', 'USD', -101000n),
        line('111005', 'TRY', 3450000n),
        line('532002', 'USD', 1000n),
      ],
    });
    expect(checkVoucherShape(exchange)).toEqual({
      given: 101000n,
      givenCurrency: 'USD',
      received: 3450000n,
      receivedCurrency: 'TRY',
      fee: 1000n,
    });
  });

  it('refuses a transfer to itself, a fee that is not an expense, and one currency out of balance', () => {
    const lines = [line('111002', 'USD', -50500n), line('111004', 'USD', 50000n)];
    expect(
      refusal(() =>
        checkVoucherShape(voucher({ kind: 'transfer', counterCashAccount: usdBox, lines })),
      ),
    ).toBe('CASH_ACCOUNT_INVALID');
    expect(
      refusal(() =>
        checkVoucherShape(
          voucher({
            kind: 'transfer',
            counterCashAccount: usdBank,
            lines: [...lines, line('313001', 'USD', 500n)],
          }),
        ),
      ),
    ).toBe('CASH_ACCOUNT_INVALID');
    expect(
      refusal(() =>
        checkVoucherShape(voucher({ kind: 'transfer', counterCashAccount: usdBank, lines })),
      ),
    ).toBe('CASH_ACCOUNT_INVALID');
    expect(
      checkVoucherShape(
        voucher({
          kind: 'transfer',
          counterCashAccount: usdBank,
          lines: [...lines, line('532002', 'USD', 500n)],
        }),
      ),
    ).toMatchObject({ given: 50500n, received: 50000n, fee: 500n });
  });

  it('takes a count of a box with no lines, and refuses a count of a bank account', () => {
    expect(
      checkVoucherShape(voucher({ kind: 'count', cashAccount: tryBox, lines: [] })),
    ).toBeNull();
    expect(
      refusal(() => checkVoucherShape(voucher({ kind: 'count', cashAccount: usdBank, lines: [] }))),
    ).toBe('CASH_ACCOUNT_INVALID');
  });
});

const exchange = (
  given: bigint,
  givenCurrency: CurrencyCode,
  received: bigint,
  receivedCurrency: CurrencyCode,
  fee = 0n,
): TransferAmounts => ({ given, givenCurrency, received, receivedCurrency, fee });

describe('the derived dealt rate (S11 rule 12)', () => {
  it("is the scenarios' rates, in the company's orientation, to 10 decimals", () => {
    expect(
      derivedDealtRate(exchange(101000n, 'USD', 3450000n, 'TRY', 1000n), {
        base: 'USD',
        quote: 'TRY',
      }),
    ).toEqual({ base: 'USD', quote: 'TRY', rate: '34.5000000000' });
    // 10,000.00 TRY for 293.00 USD: 34.12969283276450… rounded half away from zero.
    expect(
      derivedDealtRate(exchange(1000000n, 'TRY', 29300n, 'USD'), { base: 'USD', quote: 'TRY' }),
    ).toEqual({ base: 'USD', quote: 'TRY', rate: '34.1296928328' });
    expect(
      derivedDealtRate(exchange(1000000n, 'TRY', 3600000n, 'SYP'), { base: 'TRY', quote: 'SYP' }),
    ).toEqual({ base: 'TRY', quote: 'SYP', rate: '3.6000000000' });
  });

  it('is null in one currency, and a rate below 10^-10 is refused', () => {
    expect(
      derivedDealtRate(exchange(50500n, 'USD', 50000n, 'USD', 500n), { base: 'USD', quote: 'SYP' }),
    ).toBeNull();
    expect(
      refusal(() =>
        derivedDealtRate(exchange(10n ** 15n, 'TRY', 1n, 'USD'), { base: 'TRY', quote: 'USD' }),
      ),
    ).toBe('INVALID_RATE');
  });
});

describe("a count's lines (S11 rule 13)", () => {
  const count = {
    box: '111005',
    currency: 'TRY' as const,
    shortageAccount: '532007',
    overageAccount: '422002',
  };

  it('posts a shortage to 532007 and an overage to 422002, and nothing when they match', () => {
    expect(countLines({ ...count, countedMinor: 3445000n, expectedMinor: 3450000n })).toEqual([
      line('532007', 'TRY', 5000n),
      line('111005', 'TRY', -5000n),
    ]);
    expect(countLines({ ...count, countedMinor: 200300n, expectedMinor: 200000n })).toEqual([
      line('111005', 'TRY', 300n),
      line('422002', 'TRY', -300n),
    ]);
    expect(countLines({ ...count, countedMinor: 7n, expectedMinor: 7n })).toEqual([]);
  });
});

describe("a box's balance (S11 rules 8 and 13)", () => {
  it('may be below zero, and a later receipt raises it again (owner, 2026-11-20)', () => {
    const later = [
      { date: '2026-12-02', amountMinor: -120000n },
      { date: '2026-12-03', amountMinor: 50000n },
    ];
    expect(balanceAtEnd({ opening: 100000n, later, on: '2026-12-02' })).toBe(-20000n);
    expect(balanceAtEnd({ opening: -20000n, later: later.slice(1), on: '2026-12-03' })).toBe(
      30000n,
    );
  });
});

// The client's shape (S11 "The client's currencies"): a USD book at market accepting dealt rates
// and an SYP parallel ledger at the bulletin.
const client: CompanyLedgers = {
  book: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
  parallel: {
    currency: 'SYP',
    ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
  },
};
const realised = { gain: { account: 'G' }, loss: { account: 'L' } };
const rounding = { account: 'R' };

/** A rate of four decimals from its value times 10^4. */
const fourPlaces = (scaled: bigint) =>
  `${scaled / 10_000n}.${String(scaled % 10_000n).padStart(4, '0')}`;

describe('an exchange voucher measured with its derived rate', () => {
  it("is the scenario's entry: the book left with nothing, a 750.00 SYP gain in the parallel ledger", () => {
    const amounts = exchange(101000n, 'USD', 3450000n, 'TRY', 1000n);
    const dealt = derivedDealtRate(amounts, { base: 'USD', quote: 'TRY' });
    const on = '2026-12-01';
    const rates = [
      rate('USD', 'SYP', '120.0000', 'bulletin', on),
      rate('TRY', 'SYP', '3.5000', 'bulletin', on),
      rate('USD', 'TRY', '34.0000', 'market', on),
    ];
    const lines = manualEntryLines(
      {
        lines: [
          { account: '111002', amount: money(-101000n, 'USD') },
          { account: '111005', amount: money(3450000n, 'TRY') },
          { account: '532002', amount: money(1000n, 'USD') },
        ],
        dealtRates:
          dealt === null ? [] : [{ ...dealt, effectiveOn: on, type: 'market', source: 'manual' }],
      },
      { ledgers: client, on, rates, calendar },
      realised,
    );
    const entry = balanceEntry({ on, ledgers: client, lines, rounding });
    expect(entry.map((l) => [l.account, l.bookMinor, l.parallelMinor])).toEqual([
      ['111002', -101000n, -12120000n],
      ['111005', 100000n, 12075000n],
      ['532002', 1000n, 120000n],
      ['G', 0n, -75000n],
    ]);
  });

  it('balances in both ledgers, each difference in one ledger, and nets to zero with its reversal', () => {
    const on = '2026-12-01';
    fc.assert(
      fc.property(
        fc.bigInt({ min: 100n, max: 10_000_000n }),
        fc.bigInt({ min: 3_000n, max: 4_000n }),
        fc.bigInt({ min: 0n, max: 99n }),
        fc.bigInt({ min: 300_000n, max: 400_000n }),
        fc.bigInt({ min: 30_000n, max: 40_000n }),
        fc.boolean(),
        (given, dealtTimes100, feeShare, usdTry, trySyp, intoTry) => {
          const fee = (given * feeShare) / 100n;
          // A realistic exchange: 30 to 40 TRY per USD, as dealt at a money changer.
          const received = intoTry
            ? ((given - fee) * dealtTimes100) / 100n
            : (given * 100n) / dealtTimes100;
          if (received <= 0n) return;
          if (given - fee <= 0n) return;
          const [from, to]: [CurrencyCode, CurrencyCode] = intoTry
            ? ['USD', 'TRY']
            : ['TRY', 'USD'];
          const amounts = exchange(given, from, received, to, from === 'USD' ? fee : 0n);
          let dealt: ReturnType<typeof derivedDealtRate>;
          try {
            dealt = derivedDealtRate(amounts, { base: 'USD', quote: 'TRY' });
          } catch {
            return;
          }
          const rates = [
            rate('USD', 'SYP', '120.0000', 'bulletin', on),
            rate('TRY', 'SYP', fourPlaces(trySyp), 'bulletin', on),
            rate('USD', 'TRY', fourPlaces(usdTry), 'market', on),
          ];
          const typed = [
            { account: 'S', amount: money(-amounts.given, from) },
            { account: 'D', amount: money(received, to) },
            ...(amounts.fee > 0n ? [{ account: 'F', amount: money(amounts.fee, from) }] : []),
          ];
          const lines = manualEntryLines(
            {
              lines: typed,
              dealtRates:
                dealt === null
                  ? []
                  : [{ ...dealt, effectiveOn: on, type: 'market', source: 'manual' }],
            },
            { ledgers: client, on, rates, calendar },
            realised,
          );
          const entry = balanceEntry({ on, ledgers: client, lines, rounding });
          for (const [ledger] of keptLedgers(client)) expect(ledgerTotal(entry, ledger)).toBe(0n);
          for (const difference of entry.filter((l) => l.kind === 'difference')) {
            const other =
              difference.kind === 'difference' && difference.ledger === 'book'
                ? 'parallel'
                : 'book';
            expect(ledgerAmount(difference, other) ?? 0n).toBe(0n);
          }
          // The book takes the dealt rate: what it is left with is under one cent.
          const book = entry.filter((l) => l.kind === 'difference' && l.ledger === 'book');
          for (const difference of book)
            expect(difference.bookMinor * difference.bookMinor <= 1n).toBe(true);
          const reversal = reverseLines(entry);
          for (const [ledger] of keptLedgers(client)) {
            expect(ledgerTotal([...entry, ...reversal], ledger)).toBe(0n);
            expect(ledgerTotal(reversal, ledger)).toBe(0n);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
