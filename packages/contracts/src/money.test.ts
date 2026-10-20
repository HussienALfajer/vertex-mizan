import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DomainError, type ErrorCode } from './errors.js';
import {
  type CrossRate,
  CURRENCY_CODES,
  type CurrencyCode,
  checkCurrencyDate,
  companyLedgersSchema,
  convert,
  currencies,
  currencyCodeSchema,
  type ExchangeRate,
  exchangeRateSchema,
  minorAmountSchema,
  money,
  ratePolicySchema,
  sumsToZeroExactly,
} from './money.js';
import { divideHalfAwayFromZero, MINOR_MAX, MINOR_MIN } from './money-arithmetic.js';

/** A synthetic rate row; the values in this file are examples, not real rates. */
function quote(
  base: CurrencyCode,
  quoteCurrency: CurrencyCode,
  rate: string,
  extra: Partial<ExchangeRate> = {},
): ExchangeRate {
  return {
    effectiveOn: '2026-10-20',
    base,
    quote: quoteCurrency,
    rate,
    type: 'market',
    source: 'manual',
    ...extra,
  };
}

function refusal(run: () => unknown): ErrorCode | 'none' {
  try {
    run();
    return 'none';
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
}

const usdSyp = quote('USD', 'SYP', '118.5');

describe('currencies', () => {
  it('are USD, SYP, TRY and EUR, each with two decimals (ADR 0007)', () => {
    expect(CURRENCY_CODES).toEqual(['USD', 'SYP', 'TRY', 'EUR']);
    for (const code of CURRENCY_CODES) expect(currencies[code].exponent).toBe(2);
  });

  it('publish their exponents with the schema', () => {
    const { schemas } = z.toJSONSchema(z.globalRegistry);
    expect(schemas.CurrencyCode).toMatchObject({
      enum: ['USD', 'SYP', 'TRY', 'EUR'],
      'x-exponents': { USD: 2, SYP: 2, TRY: 2, EUR: 2 },
    });
    expect(currencyCodeSchema.safeParse('JPY').success).toBe(false);
  });
});

describe('amounts', () => {
  it('are bigint minor units within the stored range, symmetric so a reversal fits', () => {
    expect(money(-12_345n, 'USD')).toEqual({ amountMinor: -12_345n, currency: 'USD' });
    expect(money(MINOR_MAX, 'SYP').amountMinor).toBe(9_223_372_036_854_775_807n);
    expect(MINOR_MIN).toBe(-MINOR_MAX);
    expect(refusal(() => money(MINOR_MAX + 1n, 'SYP'))).toBe('AMOUNT_OUT_OF_RANGE');
    expect(refusal(() => money(MINOR_MIN - 1n, 'SYP'))).toBe('AMOUNT_OUT_OF_RANGE');
    expect(minorAmountSchema.safeParse(MINOR_MAX + 1n).success).toBe(false);
    expect(minorAmountSchema.safeParse(100).success).toBe(false);
  });

  it('refuse SYP dated before the new pound', () => {
    expect(refusal(() => checkCurrencyDate('SYP', '2025-12-31'))).toBe('SYP_BEFORE_REDENOMINATION');
    expect(refusal(() => checkCurrencyDate('SYP', '2026-01-01'))).toBe('none');
    expect(refusal(() => checkCurrencyDate('USD', '2025-12-31'))).toBe('none');
  });
});

describe('exchange rates', () => {
  it('are positive decimals with up to 10 places, kept exactly as quoted', () => {
    for (const rate of ['118.5', '118.5000', '0.0084033613', '1', '999999999999.9999999999']) {
      expect(exchangeRateSchema.parse(quote('USD', 'SYP', rate)).rate).toBe(rate);
    }
  });

  it('refuse zero, negatives, more than 10 places, exponents, leading zeros and padding', () => {
    for (const rate of [
      '0',
      '0.0000000000',
      '-1',
      '1.12345678901',
      '1e3',
      '01.5',
      ' 1',
      '1.',
      '.5',
      '1000000000000',
      '',
    ]) {
      expect(exchangeRateSchema.safeParse(quote('USD', 'SYP', rate)).success, rate).toBe(false);
    }
  });

  it('carry a type, a source and an effective date', () => {
    expect(
      exchangeRateSchema.safeParse(quote('USD', 'SYP', '1', { type: 'bulletin' })).success,
    ).toBe(true);
    for (const extra of [
      { type: 'official' },
      { source: 'bank' },
      { effectiveOn: '2026-02-30' },
      { effectiveOn: '20/10/2026' },
    ]) {
      expect(exchangeRateSchema.safeParse({ ...usdSyp, ...extra }).success).toBe(false);
    }
  });

  it('refuse a currency quoted in itself and an SYP rate before the new pound', () => {
    const self = exchangeRateSchema.safeParse(quote('USD', 'USD', '1'));
    expect(self.error?.issues[0]?.path).toEqual(['quote']);
    const old = exchangeRateSchema.safeParse(
      quote('SYP', 'TRY', '0.3', { effectiveOn: '2025-12-31' }),
    );
    expect(old.error?.issues[0]?.path).toEqual(['effectiveOn']);
    expect(
      exchangeRateSchema.safeParse(quote('USD', 'TRY', '41', { effectiveOn: '2025-12-31' }))
        .success,
    ).toBe(true);
  });
});

describe('convert', () => {
  it('multiplies from the base currency to the quote currency', () => {
    // $100.00 at 118.5 SYP per USD = 11 850.00 SYP
    expect(convert(money(10_000n, 'USD'), 'SYP', usdSyp)).toEqual(money(1_185_000n, 'SYP'));
  });

  it('divides from the quote currency to the base by the rate as quoted, never an inverse', () => {
    expect(convert(money(1_185_000n, 'SYP'), 'USD', usdSyp)).toEqual(money(10_000n, 'USD'));
    // 1 000 000 000 000.00 SYP at 3 SYP per USD is 333 333 333 333.333… USD. A stored inverse
    // (0.3333333333) would give 333 333 333 300.00, wrong by 33.33 USD.
    const result = convert(money(100_000_000_000_000n, 'SYP'), 'USD', quote('USD', 'SYP', '3'));
    expect(result.amountMinor).toBe(33_333_333_333_333n);
  });

  it('rounds half away from zero, in both directions and both signs', () => {
    const half = quote('USD', 'SYP', '0.5');
    // 0.005 → 0.01; 0.015 → 0.02; −0.005 → −0.01; −0.015 → −0.02
    expect(convert(money(1n, 'USD'), 'SYP', half).amountMinor).toBe(1n);
    expect(convert(money(3n, 'USD'), 'SYP', half).amountMinor).toBe(2n);
    expect(convert(money(-1n, 'USD'), 'SYP', half).amountMinor).toBe(-1n);
    expect(convert(money(-3n, 'USD'), 'SYP', half).amountMinor).toBe(-2n);
    // 0.01 SYP ÷ 2 = 0.005 → 0.01; ÷ 3 = 0.0033 → 0
    expect(convert(money(1n, 'SYP'), 'USD', quote('USD', 'SYP', '2')).amountMinor).toBe(1n);
    expect(convert(money(-1n, 'SYP'), 'USD', quote('USD', 'SYP', '2')).amountMinor).toBe(-1n);
    expect(convert(money(1n, 'SYP'), 'USD', quote('USD', 'SYP', '3')).amountMinor).toBe(0n);
  });

  it('uses all ten decimals of the rate exactly', () => {
    // $1 000 000.00 × 118.1234567891 = 118 123 456.7891 SYP → 118 123 456.79
    const rate = quote('USD', 'SYP', '118.1234567891');
    expect(convert(money(100_000_000n, 'USD'), 'SYP', rate).amountMinor).toBe(11_812_345_679n);
  });

  it('stays exact beyond the safe integer range and refuses results outside the stored range', () => {
    // 90 000 000 000 000 000.00 SYP ÷ 118.5 = 759 493 670 886 075.949… USD
    const large = money(9_000_000_000_000_000_000n, 'SYP');
    expect(convert(large, 'USD', usdSyp).amountMinor).toBe(75_949_367_088_607_595n);
    expect(refusal(() => convert(money(MINOR_MAX, 'USD'), 'SYP', usdSyp))).toBe(
      'AMOUNT_OUT_OF_RANGE',
    );
    expect(
      refusal(() => convert({ amountMinor: MINOR_MAX + 1n, currency: 'USD' }, 'SYP', usdSyp)),
    ).toBe('AMOUNT_OUT_OF_RANGE');
  });

  it('refuses a rate of another pair, an amount in its own currency and an invalid rate', () => {
    expect(refusal(() => convert(money(100n, 'EUR'), 'SYP', usdSyp))).toBe('RATE_PAIR_MISMATCH');
    expect(refusal(() => convert(money(100n, 'USD'), 'TRY', usdSyp))).toBe('RATE_PAIR_MISMATCH');
    expect(refusal(() => convert(money(100n, 'USD'), 'USD', usdSyp))).toBe('RATE_PAIR_MISMATCH');
    expect(refusal(() => convert(money(100n, 'USD'), 'SYP', quote('USD', 'SYP', '0')))).toBe(
      'INVALID_RATE',
    );
    expect(refusal(() => convert(money(100n, 'USD'), 'USD', quote('USD', 'USD', '1')))).toBe(
      'INVALID_RATE',
    );
    const old = quote('USD', 'SYP', '118.5', { effectiveOn: '2025-12-31' });
    expect(refusal(() => convert(money(100n, 'USD'), 'SYP', old))).toBe(
      'SYP_BEFORE_REDENOMINATION',
    );
  });
});

describe('convert with a cross rate', () => {
  const trySyp = quote('TRY', 'SYP', '2.9');
  /** Two quotes applied on the entry date 2026-10-20. */
  const cross = (first: ExchangeRate, second: ExchangeRate, on = '2026-10-20'): CrossRate => ({
    on,
    legs: [first, second],
  });

  it('crosses a third currency through two quotes of the same type and date', () => {
    // 1 000.00 TRY × 2.9 ÷ 118.5 = 24.4725… USD
    expect(convert(money(100_000n, 'TRY'), 'USD', cross(trySyp, usdSyp))).toEqual(
      money(2_447n, 'USD'),
    );
    // Back: 24.47 USD × 118.5 ÷ 2.9 = 999.89… TRY
    expect(convert(money(2_447n, 'USD'), 'TRY', cross(usdSyp, trySyp)).amountMinor).toBe(99_989n);
    // Either quote may have either currency as its base: 0.345 TRY per SYP.
    const sypTry = quote('SYP', 'TRY', '0.345');
    // 1 000.00 TRY ÷ 0.345 ÷ 118.5 = 24.4606… USD
    expect(convert(money(100_000n, 'TRY'), 'USD', cross(sypTry, usdSyp)).amountMinor).toBe(2_446n);
  });

  it('rounds once, on the exact product, never at the intermediate currency', () => {
    // 1.43 TRY × 2.9 ÷ 118.5 = 0.034996 USD → 0.03. Rounding first to 4.15 SYP would give
    // 0.035021 → 0.04, more than half a cent from the exact value.
    expect(convert(money(143n, 'TRY'), 'USD', cross(trySyp, usdSyp)).amountMinor).toBe(3n);
  });

  it('accepts quotes of one type in force on the entry date, whatever their effective dates', () => {
    // A weekly TRY bulletin of 2026-10-15 and a daily USD bulletin of 2026-10-19, on 2026-10-20.
    const weekly = quote('TRY', 'SYP', '2.9', { type: 'bulletin', effectiveOn: '2026-10-15' });
    const daily = quote('USD', 'SYP', '118.5', { type: 'bulletin', effectiveOn: '2026-10-19' });
    expect(convert(money(100_000n, 'TRY'), 'USD', cross(weekly, daily)).amountMinor).toBe(2_447n);
    // A quote effective on the entry date itself is in force.
    expect(
      convert(money(100_000n, 'TRY'), 'USD', cross(weekly, daily, '2026-10-19')).amountMinor,
    ).toBe(2_447n);
  });

  it('refuses quotes of different types, a quote effective after the entry date and a bad date', () => {
    const bulletin = quote('USD', 'SYP', '118.5', { type: 'bulletin' });
    const later = quote('USD', 'SYP', '118.5', { effectiveOn: '2026-10-21' });
    expect(refusal(() => convert(money(100n, 'TRY'), 'USD', cross(trySyp, bulletin)))).toBe(
      'CROSS_RATE_MISMATCH',
    );
    expect(refusal(() => convert(money(100n, 'TRY'), 'USD', cross(trySyp, later)))).toBe(
      'CROSS_RATE_MISMATCH',
    );
    expect(
      refusal(() => convert(money(100n, 'TRY'), 'USD', cross(trySyp, usdSyp, '2026-13-01'))),
    ).toBe('INVALID_RATE');
  });

  it('refuses quotes that do not chain the two currencies', () => {
    const eurSyp = quote('EUR', 'SYP', '135.2');
    // The first quote does not have the source currency.
    expect(refusal(() => convert(money(100n, 'TRY'), 'USD', cross(eurSyp, usdSyp)))).toBe(
      'RATE_PAIR_MISMATCH',
    );
    // The second quote does not pair the intermediate currency with the target.
    expect(refusal(() => convert(money(100n, 'TRY'), 'USD', cross(trySyp, eurSyp)))).toBe(
      'RATE_PAIR_MISMATCH',
    );
    // A currency crossed back to itself: 1 000.00 TRY × 2.9 × 0.345 would invent 0.50 TRY.
    const sypTry = quote('SYP', 'TRY', '0.345');
    expect(refusal(() => convert(money(100_000n, 'TRY'), 'TRY', cross(trySyp, sypTry)))).toBe(
      'RATE_PAIR_MISMATCH',
    );
    // The first quote already converts directly: no cross through the target.
    const tryUsd = quote('TRY', 'USD', '0.024');
    expect(refusal(() => convert(money(100n, 'TRY'), 'USD', cross(tryUsd, usdSyp)))).toBe(
      'RATE_PAIR_MISMATCH',
    );
    const oldSyp = quote('TRY', 'SYP', '2.9', { effectiveOn: '2025-12-31' });
    expect(refusal(() => convert(money(100n, 'TRY'), 'USD', cross(oldSyp, usdSyp)))).toBe(
      'SYP_BEFORE_REDENOMINATION',
    );
  });
});

describe('sumsToZeroExactly', () => {
  const half = quote('USD', 'SYP', '0.5');

  it('sums the exact values convert() would round', () => {
    // 0.03 USD against 0.01 USD three times at 0.5: 0.015 − 3 × 0.005 = 0 exactly, though the
    // rounded amounts (0.02 and 0.01 three times) leave 0.01 SYP over.
    const terms = [3n, -1n, -1n, -1n].map((cents) => ({ amount: money(cents, 'USD'), rate: half }));
    expect(sumsToZeroExactly('SYP', terms)).toBe(true);
    expect(terms.map((term) => convert(term.amount, 'SYP', half).amountMinor)).toEqual([
      2n,
      -1n,
      -1n,
      -1n,
    ]);
    // 0.03 USD against 0.02 USD: 0.005 SYP over, exactly.
    const short = [3n, -2n].map((cents) => ({ amount: money(cents, 'USD'), rate: half }));
    expect(sumsToZeroExactly('SYP', short)).toBe(false);
  });

  it('takes amounts in the currency as they are, and crosses exactly', () => {
    // 1.43 TRY × 2.9 ÷ 118.5 = 0.0349957… USD, never equal to a whole number of cents.
    const cross: CrossRate = { on: '2026-10-20', legs: [quote('TRY', 'SYP', '2.9'), usdSyp] };
    expect(
      sumsToZeroExactly('USD', [
        { amount: money(143n, 'TRY'), rate: cross },
        { amount: money(-3n, 'USD') },
      ]),
    ).toBe(false);
    // 2.37 TRY × 2.9 ÷ 118.5 = 5.8 cents, five times 29 cents exactly, though each part
    // rounds to 6 cents.
    const parts = [1, 2, 3, 4, 5].map(() => ({ amount: money(237n, 'TRY'), rate: cross }));
    expect(sumsToZeroExactly('USD', [...parts, { amount: money(-29n, 'USD') }])).toBe(true);
    expect(sumsToZeroExactly('USD', [...parts, { amount: money(-30n, 'USD') }])).toBe(false);
    expect(sumsToZeroExactly('SYP', [])).toBe(true);
  });

  it('checks its terms as convert() does', () => {
    expect(
      refusal(() => sumsToZeroExactly('SYP', [{ amount: money(100n, 'EUR'), rate: usdSyp }])),
    ).toBe('RATE_PAIR_MISMATCH');
    expect(refusal(() => sumsToZeroExactly('SYP', [{ amount: money(100n, 'USD') }]))).toBe(
      'RATE_PAIR_MISMATCH',
    );
    const outside = { amountMinor: MINOR_MAX + 1n, currency: 'USD' } as const;
    expect(refusal(() => sumsToZeroExactly('SYP', [{ amount: outside, rate: usdSyp }]))).toBe(
      'AMOUNT_OUT_OF_RANGE',
    );
    expect(refusal(() => sumsToZeroExactly('USD', [{ amount: outside }]))).toBe(
      'AMOUNT_OUT_OF_RANGE',
    );
  });
});

describe('divideHalfAwayFromZero', () => {
  it('is the one rounding, exported for allocations', () => {
    expect(divideHalfAwayFromZero(5n, 2n)).toBe(3n);
    expect(divideHalfAwayFromZero(-5n, 2n)).toBe(-3n);
    expect(divideHalfAwayFromZero(4n, 3n)).toBe(1n);
    expect(divideHalfAwayFromZero(-4n, 3n)).toBe(-1n);
  });
});

describe('rate policies', () => {
  it('accept a transaction rate under a market policy only', () => {
    expect(
      ratePolicySchema.safeParse({ rateType: 'market', acceptsTransactionRate: true }).success,
    ).toBe(true);
    expect(
      ratePolicySchema.safeParse({ rateType: 'market', acceptsTransactionRate: false }).success,
    ).toBe(true);
    expect(
      ratePolicySchema.safeParse({ rateType: 'bulletin', acceptsTransactionRate: false }).success,
    ).toBe(true);
    const refused = ratePolicySchema.safeParse({
      rateType: 'bulletin',
      acceptsTransactionRate: true,
    });
    expect(refused.error?.issues[0]?.path).toEqual(['acceptsTransactionRate']);
  });

  it('are set per ledger: a book currency and an optional, different parallel currency', () => {
    // Vertex Media (ADR 0007): book SYP at the bulletin, parallel USD at the market with Hub's rate.
    const vertexMedia = {
      book: {
        currency: 'SYP',
        ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
      },
      parallel: {
        currency: 'USD',
        ratePolicy: { rateType: 'market', acceptsTransactionRate: true },
      },
    };
    expect(companyLedgersSchema.parse(vertexMedia)).toEqual(vertexMedia);
    expect(companyLedgersSchema.safeParse({ ...vertexMedia, parallel: null }).success).toBe(true);
    const same = {
      ...vertexMedia,
      parallel: { ...vertexMedia.parallel, currency: 'SYP' },
    };
    expect(companyLedgersSchema.safeParse(same).error?.issues[0]?.path).toEqual([
      'parallel',
      'currency',
    ]);
    const bulletinWithHubRate = {
      ...vertexMedia,
      book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: true } },
    };
    expect(companyLedgersSchema.safeParse(bulletinWithHubRate).success).toBe(false);
  });
});

describe('JSON Schema', () => {
  it('holds every money schema with an id, for the OpenAPI document and Hub', () => {
    const { schemas } = z.toJSONSchema(z.globalRegistry, {
      target: 'draft-2020-12',
      unrepresentable: 'throw',
    });
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'CurrencyCode',
        'ExchangeRate',
        'RateType',
        'RateSource',
        'RatePolicy',
        'Ledger',
        'LedgerSettings',
        'CompanyLedgers',
        'ErrorCode',
      ]),
    );
  });
});
