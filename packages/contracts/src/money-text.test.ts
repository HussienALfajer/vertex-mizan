import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CURRENCY_CODES } from './money.js';
import { MINOR_MAX, MINOR_MIN } from './money-arithmetic.js';
import {
  balancingAmount,
  debitCreditOf,
  entryTotals,
  signedAmount,
  summarizeAmounts,
} from './money-summary.js';
import { amountParts, evaluateAmount, formatMinor, parseAmount } from './money-text.js';

const ok = (amountMinor: bigint) => ({ ok: true, amountMinor });
const refused = (error: string) => ({ ok: false, error });

/** Latin digits and separators as an Arabic keypad types them. */
const arabicIndic = (text: string) =>
  text
    .replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)))
    .replace(/\./g, '٫')
    .replace(/,/g, '٬');

const anyMinor = fc.bigInt({ min: MINOR_MIN, max: MINOR_MAX });
const currency = fc.constantFrom(...CURRENCY_CODES);

describe('formatMinor', () => {
  it('groups by three, keeps every decimal and puts an ASCII minus first', () => {
    expect(formatMinor(0n, 'USD')).toBe('0.00');
    expect(formatMinor(5n, 'SYP')).toBe('0.05');
    expect(formatMinor(-5n, 'SYP')).toBe('-0.05');
    expect(formatMinor(-125_000_000n, 'SYP')).toBe('-1,250,000.00');
    expect(formatMinor(125_000_000_000_00n, 'SYP')).toBe('125,000,000,000.00');
    expect(formatMinor(-125_000_000n, 'SYP', { grouping: false })).toBe('-1250000.00');
    expect(formatMinor(MINOR_MAX, 'USD')).toBe('92,233,720,368,547,758.07');
  });

  it('splits into the parts the Amount component renders', () => {
    expect(amountParts(-125_000_050n, 'SYP')).toEqual({
      negative: true,
      groups: ['1', '250', '000'],
      fraction: '50',
    });
    expect(amountParts(7n, 'USD')).toEqual({ negative: false, groups: ['0'], fraction: '07' });
  });
});

describe('parseAmount', () => {
  it('reads major units into minor units exactly', () => {
    expect(parseAmount('1,250.5', 'SYP')).toEqual(ok(125_050n));
    expect(parseAmount('1250', 'USD')).toEqual(ok(125_000n));
    expect(parseAmount('.5', 'USD')).toEqual(ok(50n));
    expect(parseAmount('5.', 'USD')).toEqual(ok(500n));
    expect(parseAmount('  -1,250.00 ', 'USD')).toEqual(ok(-125_000n));
    expect(parseAmount('−5', 'USD')).toEqual(ok(-500n));
  });

  it('reads Arabic-Indic digits and the Arabic separators', () => {
    expect(parseAmount('١٬٢٥٠٫٥٠', 'SYP')).toEqual(ok(125_050n));
    expect(parseAmount('۱۲۵۰٫۵', 'SYP')).toEqual(ok(125_050n));
    expect(parseAmount('٫٥', 'USD')).toEqual(ok(50n));
  });

  it('refuses what it would have to guess, never rounding typed decimals', () => {
    expect(parseAmount('', 'USD')).toEqual(refused('EMPTY'));
    expect(parseAmount('   ', 'USD')).toEqual(refused('EMPTY'));
    expect(parseAmount('1.234', 'USD')).toEqual(refused('TOO_MANY_DECIMALS'));
    expect(parseAmount('1,25', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('12,50,000', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('1,,250', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('1.2.3', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('(1,250.00)', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('1,250-', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('-', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('.', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('1e5', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('١٢abc', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('92233720368547758.08', 'USD')).toEqual(refused('AMOUNT_OUT_OF_RANGE'));
  });

  it('never joins two values into one: space inside a number must group correctly', () => {
    // Two cells pasted from Excel arrive with a tab, two lines with a line break.
    expect(parseAmount('1250\t750', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('1250\n750', 'USD')).toEqual(refused('INVALID'));
    // A browser turns the break into a space in a single-line field: an ordinary space between
    // digits is never grouping, even where the joined digits would group.
    expect(parseAmount('1250 750', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('500 250', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('1 250 000.50', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('1 25', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('12 50', 'USD')).toEqual(refused('INVALID'));
    // Correct grouping with no-break, thin or narrow no-break spaces is read as grouping.
    expect(parseAmount('1 250 000.50', 'USD')).toEqual(ok(125_000_050n));
    expect(parseAmount('1 250', 'USD')).toEqual(ok(125_000n));
    expect(parseAmount('500 250 1', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('- 5', 'USD')).toEqual(ok(-500n));
    expect(parseAmount('- 5', 'USD')).toEqual(ok(-500n));
    expect(parseAmount('\t1,250.00\n', 'USD')).toEqual(ok(125_000n));
  });

  it('reads a first group of zeros as a decimal comma and refuses it', () => {
    expect(parseAmount('0,500', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('00,125', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('-0,500', 'USD')).toEqual(refused('INVALID'));
  });

  it('refuses a negative amount where only magnitudes are allowed, but not zero', () => {
    const magnitudes = { allowNegative: false };
    expect(parseAmount('-5', 'USD', magnitudes)).toEqual(refused('NEGATIVE_NOT_ALLOWED'));
    expect(parseAmount('-0', 'USD', magnitudes)).toEqual(ok(0n));
    expect(parseAmount('=2-5', 'USD', magnitudes)).toEqual(refused('NEGATIVE_NOT_ALLOWED'));
  });

  it('reads back every formatted amount, grouped or not, in Latin or Arabic-Indic digits', () => {
    fc.assert(
      fc.property(anyMinor, currency, fc.boolean(), (amountMinor, code, grouping) => {
        const text = formatMinor(amountMinor, code, { grouping });
        expect(parseAmount(text, code)).toEqual(ok(amountMinor));
        expect(parseAmount(arabicIndic(text), code)).toEqual(ok(amountMinor));
      }),
    );
  });
});

describe('evaluateAmount', () => {
  it('evaluates exactly and rounds the result once, half away from zero', () => {
    expect(parseAmount('=100*3', 'USD')).toEqual(ok(30_000n));
    expect(parseAmount('=(1250+750)/4', 'USD')).toEqual(ok(50_000n));
    expect(parseAmount('=1 × 2 ÷ 4', 'USD')).toEqual(ok(50n));
    expect(parseAmount('=10/3', 'USD')).toEqual(ok(333n));
    expect(parseAmount('=-10/3', 'USD')).toEqual(ok(-333n));
    expect(parseAmount('=2/3', 'USD')).toEqual(ok(67n));
    expect(parseAmount('=0.005', 'USD')).toEqual(ok(1n));
    expect(parseAmount('=-0.005', 'USD')).toEqual(ok(-1n));
    expect(parseAmount('=0.0049', 'USD')).toEqual(ok(0n));
    expect(parseAmount('=1000*1.125', 'USD')).toEqual(ok(112_500n));
    expect(parseAmount('=10/-4', 'USD')).toEqual(ok(-250n));
    expect(parseAmount('=--5', 'USD')).toEqual(ok(500n));
    expect(parseAmount('=١٠٠٠×٣', 'SYP')).toEqual(ok(300_000n));
  });

  it('refuses malformed expressions and division by zero', () => {
    expect(parseAmount('=', 'USD')).toEqual(refused('EMPTY'));
    expect(parseAmount('=1+', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('=(1', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('=1)', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('=1,000+1', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('=2^3', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('=1 2+3', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('=1.5 0', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('=1250\t750', 'USD')).toEqual(refused('INVALID'));
    expect(parseAmount('= ( 1250 + 750 ) / 4 ', 'USD')).toEqual(ok(50_000n));
    expect(parseAmount('=1/0', 'USD')).toEqual(refused('DIVISION_BY_ZERO'));
    expect(parseAmount('=1/(2-2)', 'USD')).toEqual(refused('DIVISION_BY_ZERO'));
    expect(parseAmount(`=${'1+'.repeat(100)}1`, 'USD')).toEqual(refused('INVALID'));
    expect(evaluateAmount('99999999999999999*1000', 'USD')).toEqual(refused('AMOUNT_OUT_OF_RANGE'));
  });

  it('adds, multiplies and divides as exact integer arithmetic on minor units would', () => {
    const small = fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n });
    const divisor = fc.bigInt({ min: 1n, max: 1000n });
    fc.assert(
      fc.property(small, small, divisor, (a, b, k) => {
        const text = (minor: bigint) => `(${formatMinor(minor, 'USD', { grouping: false })})`;
        expect(evaluateAmount(`${text(a)}+${text(b)}`, 'USD')).toEqual(ok(a + b));
        expect(evaluateAmount(`${text(a)}-${text(b)}`, 'USD')).toEqual(ok(a - b));
        expect(evaluateAmount(`${text(a)}*${k}`, 'USD')).toEqual(ok(a * k));
        // a / k minor units, rounded half away from zero, computed independently.
        const quotient = a / k;
        const twice = (a % k < 0n ? -(a % k) : a % k) * 2n;
        const rounded = twice < k ? quotient : a < 0n ? quotient - 1n : quotient + 1n;
        expect(evaluateAmount(`${text(a)}/${k}`, 'USD')).toEqual(ok(rounded));
      }),
    );
  });
});

describe('summarizeAmounts', () => {
  it('summarises each currency apart, the average rounded half away from zero', () => {
    expect(
      summarizeAmounts([
        { amountMinor: 100n, currency: 'SYP' },
        { amountMinor: -50n, currency: 'USD' },
        { amountMinor: 201n, currency: 'SYP' },
        { amountMinor: -51n, currency: 'USD' },
      ]),
    ).toEqual([
      {
        currency: 'SYP',
        count: 2,
        sumMinor: 301n,
        averageMinor: 151n,
        minMinor: 100n,
        maxMinor: 201n,
      },
      {
        currency: 'USD',
        count: 2,
        sumMinor: -101n,
        averageMinor: -51n,
        minMinor: -51n,
        maxMinor: -50n,
      },
    ]);
    expect(summarizeAmounts([])).toEqual([]);
  });

  it('keeps the sum exact and the average between the minimum and the maximum', () => {
    fc.assert(
      fc.property(fc.array(anyMinor, { minLength: 1, maxLength: 50 }), (values) => {
        const [summary] = summarizeAmounts(
          values.map((amountMinor) => ({ amountMinor, currency: 'USD' })),
        );
        expect(summary?.sumMinor).toBe(values.reduce((sum, value) => sum + value, 0n));
        expect(summary?.count).toBe(values.length);
        expect(summary && summary.averageMinor >= summary.minMinor).toBe(true);
        expect(summary && summary.averageMinor <= summary.maxMinor).toBe(true);
      }),
    );
  });
});

describe('entry totals', () => {
  it('splits a signed amount into debit and credit magnitudes, and back', () => {
    expect(debitCreditOf(1250n)).toEqual({ debitMinor: 1250n, creditMinor: null });
    expect(debitCreditOf(-1250n)).toEqual({ debitMinor: null, creditMinor: 1250n });
    expect(debitCreditOf(null)).toEqual({ debitMinor: null, creditMinor: null });
    expect(signedAmount('debit', 1250n)).toBe(1250n);
    expect(signedAmount('credit', 1250n)).toBe(-1250n);
  });

  it('totals each currency apart, with its residual', () => {
    expect(
      entryTotals([
        { amountMinor: 10_000n, currency: 'USD' },
        { amountMinor: -1_225_000n, currency: 'SYP' },
        { amountMinor: 1_225_000n, currency: 'SYP' },
        { amountMinor: -9_999n, currency: 'USD' },
      ]),
    ).toEqual([
      { currency: 'USD', debitMinor: 10_000n, creditMinor: 9_999n, residualMinor: 1n },
      { currency: 'SYP', debitMinor: 1_225_000n, creditMinor: 1_225_000n, residualMinor: 0n },
    ]);
    expect(entryTotals([])).toEqual([]);
  });

  it('balances a currency with the negated sum of its other lines (property)', () => {
    const line = fc.record({
      amountMinor: fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
      currency: fc.constantFrom(...CURRENCY_CODES),
    });
    fc.assert(
      fc.property(
        fc.array(line, { maxLength: 20 }),
        fc.constantFrom(...CURRENCY_CODES),
        (others, currency) => {
          const balancing = balancingAmount(others, currency);
          const [totals] = entryTotals([
            ...others.filter((other) => other.currency === currency),
            { amountMinor: balancing, currency },
          ]);
          expect(totals?.residualMinor).toBe(0n);
          const { debitMinor, creditMinor } = debitCreditOf(balancing);
          expect(
            debitMinor !== null
              ? signedAmount('debit', debitMinor)
              : signedAmount('credit', creditMinor ?? 0n),
          ).toBe(balancing);
        },
      ),
    );
  });
});
