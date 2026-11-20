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
import {
  amountParts,
  evaluateAmount,
  formatMinor,
  groupTypedDecimal,
  parseAmount,
  spreadsheetAmount,
  ungroupTypedDecimal,
} from './money-text.js';

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

describe('spreadsheetAmount', () => {
  it('is a number in major units when a spreadsheet holds it exactly', () => {
    expect(spreadsheetAmount(12_000_000n, 'SYP')).toBe(120000);
    expect(spreadsheetAmount(-40_000n, 'USD')).toBe(-400);
    expect(spreadsheetAmount(5n, 'USD')).toBe(0.05);
    expect(spreadsheetAmount(0n, 'TRY')).toBe(0);
    expect(spreadsheetAmount(999_999_999_999_999n, 'USD')).toBe(9_999_999_999_999.99);
  });

  it('is the exact text beyond 15 significant digits, never a rounded number', () => {
    expect(spreadsheetAmount(1_000_000_000_000_000n, 'USD')).toBe('10000000000000.00');
    expect(spreadsheetAmount(-1_234_567_890_123_456_789n, 'SYP')).toBe('-12345678901234567.89');
  });

  it('round-trips through the money text for every number it gives (property)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -999_999_999_999_999n, max: 999_999_999_999_999n }),
        fc.constantFrom(...CURRENCY_CODES),
        (amount, currency) => {
          const cell = spreadsheetAmount(amount, currency);
          expect(typeof cell).toBe('number');
          const parsed = parseAmount(String(cell), currency);
          expect(parsed).toEqual({ ok: true, amountMinor: amount });
        },
      ),
    );
  });
});

describe('groupTypedDecimal', () => {
  const at = (text: string, caret = text.length) => groupTypedDecimal({ text, caret });

  it.each([
    ['1234567', '1,234,567'],
    ['1,250,000', '1,250,000'],
    ['-1234.5', '-1,234.5'],
    ['1234.', '1,234.'],
    ['.5', '.5'],
    ['0.50', '0.50'],
    ['000123', '123'],
    ['0', '0'],
    ['-', '-'],
    ['', ''],
    ['١٢٣٤٫٥', '1,234.5'],
  ])('groups %s as %s', (typed, grouped) => {
    expect(at(typed).text).toBe(grouped);
  });

  it.each([['=1000*3'], ['1 000'], ['12a'], ['1.2.3'], ['1e3'], ['1,5 '], [' 1,5']])(
    'leaves %s as typed, for the parser to judge',
    (typed) => {
      expect(at(typed, 2)).toEqual({ text: typed, caret: 2 });
    },
  );

  it.each([
    ['3,75', ''],
    ['0,500', ''],
    ['1,5', '1'],
    ['3,75', '3,7'],
    ['1,23,4567', ''],
    ['1,234,', '1,234'],
    ['٣٬٧٥', ''],
    // Pasted over the whole of a grouped field, or over part of it.
    ['3,75', '1,000'],
    ['3,75', '1,250.00'],
    ['0,500', '1,000'],
    ['15,5', '12,000'],
  ])('leaves %s (a comma not of its own grouping, after %s) as typed', (typed, previous) => {
    expect(groupTypedDecimal({ text: typed, caret: 1 }, { previous, pasted: typed })).toEqual({
      text: typed,
      caret: 1,
    });
    expect(groupTypedDecimal({ text: typed, caret: 1 }, { previous })).toEqual({
      text: typed,
      caret: 1,
    });
  });

  it('moves its own grouping commas when a digit or one of them is typed or deleted', () => {
    // A comma deleted by Backspace: "1,|234,567" → "1|234,567".
    expect(groupTypedDecimal({ text: '1234,567', caret: 1 }, { previous: '1,234,567' })).toEqual({
      text: '1,234,567',
      caret: 1,
    });
    // A digit deleted: "1,000" → "1,00".
    expect(groupTypedDecimal({ text: '1,00', caret: 4 }, { previous: '1,000' })).toEqual({
      text: '100',
      caret: 3,
    });
    // A digit typed between groups.
    expect(groupTypedDecimal({ text: '1,2345', caret: 6 }, { previous: '1,234' })).toEqual({
      text: '12,345',
      caret: 6,
    });
  });

  it('judges a paste by what was pasted, though it looks like a deletion', () => {
    // "1,5" pasted over "1,500" reads, from the text alone, as two zeros deleted.
    expect(
      groupTypedDecimal({ text: '1,5', caret: 3 }, { previous: '1,500', pasted: '1,5' }).text,
    ).toBe('1,5');
    expect(groupTypedDecimal({ text: '1,5', caret: 3 }, { previous: '1,500' }).text).toBe('15');
  });

  it('regroups a correctly grouped paste and a paste of digits over a grouped field', () => {
    expect(groupTypedDecimal({ text: '2,500,000', caret: 9 }, { previous: '1,000' }).text).toBe(
      '2,500,000',
    );
    expect(groupTypedDecimal({ text: '1,0005', caret: 6 }, { previous: '1,000' }).text).toBe(
      '10,005',
    );
  });

  it('never makes a paste into a grouped field mean another amount', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.stringMatching(/^[\d,.]{1,6}$/),
        fc.nat(),
        fc.nat(),
        (amount, pasted, from, length) => {
          const previous = groupTypedDecimal({ text: amount.toString(), caret: 0 }).text;
          const start = from % (previous.length + 1);
          const end = Math.min(previous.length, start + (length % 4));
          const typed = previous.slice(0, start) + pasted + previous.slice(end);
          const { text } = groupTypedDecimal({ text: typed, caret: start }, { previous, pasted });
          if (text === typed) return;
          // Regrouped: either the pasted text put in no comma, or the whole text was grouped
          // correctly; either way the digits are the typed ones and parse to the same amount.
          expect(!pasted.includes(',') || parseAmount(typed, 'USD').ok).toBe(true);
          expect(text.replaceAll(',', '')).toBe(typed.replaceAll(',', '').replace(/^0+(?=\d)/, ''));
        },
      ),
    );
  });

  it('leaves a minus as typed where negatives are refused', () => {
    expect(groupTypedDecimal({ text: '-1000', caret: 5 }, { allowNegative: false })).toEqual({
      text: '-1000',
      caret: 5,
    });
  });

  it('keeps the caret after the same digit', () => {
    expect(at('1234567')).toEqual({ text: '1,234,567', caret: 9 });
    // "1,234,9|567": a 9 typed after the 4.
    expect(groupTypedDecimal({ text: '1,234,9567', caret: 7 }, { previous: '1,234,567' })).toEqual({
      text: '12,349,567',
      caret: 6,
    });
    // A comma removed by Backspace: "1,000" → "1|000".
    expect(at('1000', 1)).toEqual({ text: '1,000', caret: 1 });
    // Leading zeros dropped before the caret.
    expect(at('0012', 3)).toEqual({ text: '12', caret: 1 });
    expect(at('', 0)).toEqual({ text: '', caret: 0 });
  });

  it('never changes the digits, so parsing the grouped text gives the typed amount', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^-?[1-9]\d{0,12}(\.\d{0,2})?$/),
        fc.nat(),
        (typed, position) => {
          const caret = position % (typed.length + 1);
          const result = groupTypedDecimal({ text: typed, caret });
          expect(ungroupTypedDecimal(result.text)).toBe(typed.replace(/^(-?)0+(?=\d)/, '$1'));
          expect(result.caret).toBeGreaterThanOrEqual(0);
          expect(result.caret).toBeLessThanOrEqual(result.text.length);
          expect(parseAmount(result.text, 'USD')).toEqual(parseAmount(typed, 'USD'));
        },
      ),
    );
  });

  it('never makes text with commas mean another amount', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^-?[\d,]{0,10}(\.[\d,]{0,3})?$/), (typed) => {
        const { text } = groupTypedDecimal({ text: typed, caret: typed.length });
        expect(parseAmount(text, 'USD')).toEqual(parseAmount(typed, 'USD'));
        // A schema that reads plain digits sees the same number, or text it refuses.
        const plain = ungroupTypedDecimal(text);
        if (!plain.includes(',')) {
          expect(parseAmount(plain, 'USD')).toEqual(parseAmount(typed, 'USD'));
        }
      }),
    );
  });
});

describe('ungroupTypedDecimal', () => {
  it('drops grouping commas and reads Arabic digits and separators', () => {
    expect(ungroupTypedDecimal('1,234,567.5')).toBe('1234567.5');
    expect(ungroupTypedDecimal('١٬٢٣٤٫٥')).toBe('1234.5');
  });

  it.each([['1,5'], ['1,5 '], [' 1,5'], ['0,500'], ['3,75'], ['12,50,000'], ['1,234,']])(
    'keeps the commas of %s, which do not group thousands, for the schema to refuse',
    (typed) => {
      expect(ungroupTypedDecimal(typed)).toContain(',');
    },
  );
});
