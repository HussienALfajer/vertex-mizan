import { type CurrencyCode, currencies } from './money.js';
import { divideHalfAwayFromZero, MINOR_MAX, MINOR_MIN } from './money-arithmetic.js';

/**
 * Amounts as text (ADR 0007, ADR 0010 §3 and §4): the one formatting and the one parsing of
 * amounts, so no screen, export or import does arithmetic on them. Text is Latin digits, `,`
 * grouping, `.` decimals and an ASCII hyphen-minus, which Excel reads as a number.
 */

/** The parts of a formatted amount: the sign, the integer digits in groups of three, the decimals. */
export interface AmountParts {
  readonly negative: boolean;
  readonly groups: readonly string[];
  /** Exactly the currency's exponent of digits; empty for a currency without decimals. */
  readonly fraction: string;
}

/** The parts `formatMinor()` joins; the Amount component renders them one by one. */
export function amountParts(amountMinor: bigint, currency: CurrencyCode): AmountParts {
  const { exponent } = currencies[currency];
  const negative = amountMinor < 0n;
  const digits = (negative ? -amountMinor : amountMinor).toString().padStart(exponent + 1, '0');
  const integer = digits.slice(0, digits.length - exponent);
  const groups: string[] = [];
  for (let end = integer.length; end > 0; end -= 3) {
    groups.unshift(integer.slice(Math.max(0, end - 3), end));
  }
  return { negative, groups, fraction: digits.slice(digits.length - exponent) };
}

/** `-1,250,000.00`: grouped, with every decimal of the currency, never rounded or abbreviated. */
export function formatMinor(
  amountMinor: bigint,
  currency: CurrencyCode,
  { grouping = true }: { grouping?: boolean } = {},
): string {
  const { negative, groups, fraction } = amountParts(amountMinor, currency);
  const integer = groups.join(grouping ? ',' : '');
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

/** Why typed text is not an amount. `AMOUNT_OUT_OF_RANGE` is the error code of the same rule. */
export type AmountTextError =
  | 'EMPTY'
  | 'INVALID'
  | 'TOO_MANY_DECIMALS'
  | 'NEGATIVE_NOT_ALLOWED'
  | 'DIVISION_BY_ZERO'
  | 'AMOUNT_OUT_OF_RANGE';

export type AmountTextResult =
  | { readonly ok: true; readonly amountMinor: bigint }
  | { readonly ok: false; readonly error: AmountTextError };

const refuse = (error: AmountTextError): AmountTextResult => ({ ok: false, error });

/**
 * Arabic-Indic (U+0660-0669) and Eastern Arabic-Indic (U+06F0-06F9) digits to Latin, the Arabic
 * decimal and thousands separators (U+066B, U+066C) to `.` and `,`, and the minus sign (U+2212)
 * to `-`: what an Arabic keyboard or keypad types. Space at either end is dropped; space inside is
 * left for the caller to judge, since it may join two values into one.
 */
function normalize(text: string): string {
  return text
    .trim()
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066b/g, '.')
    .replace(/\u066c/g, ',')
    .replace(/\u2212/g, '-');
}

/**
 * A no-break, thin or narrow no-break space: what formatted exports put between digit groups. An
 * ordinary space is not one: a browser turns the line breaks of pasted cells into spaces, so
 * `500 250` may be two values.
 */
const GROUP_SPACE = /[\u00a0\u2009\u202f]/g;

/** A tab or a line break inside the text: two pasted cells or lines, never one amount. */
const SEPARATE_VALUES = /[\t\n\r\v\f\u2028\u2029]/;

/** An exact decimal as a fraction of integers: `12.5` → 125 / 10. */
interface Fraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

function inRange(amountMinor: bigint): AmountTextResult {
  return amountMinor < MINOR_MIN || amountMinor > MINOR_MAX
    ? refuse('AMOUNT_OUT_OF_RANGE')
    : { ok: true, amountMinor };
}

/**
 * Thousands separators only where they belong: `1,250,000`, never `1,25`, `12,50,000` or `0,500`
 * (a first group of zeros is a decimal comma, not grouping).
 */
const GROUPED = /^[1-9]\d{0,2}(,\d{3})+$/;

/**
 * Typed text in major units → minor units, exactly. Grouping is optional but must be correct;
 * decimals beyond the currency's exponent are refused, never rounded. Text starting with `=` is an
 * expression (`evaluateAmount()`).
 */
export function parseAmount(
  text: string,
  currency: CurrencyCode,
  { allowNegative = true }: { allowNegative?: boolean } = {},
): AmountTextResult {
  const trimmed = normalize(text);
  if (trimmed === '') return refuse('EMPTY');
  if (trimmed.startsWith('=')) return evaluateAmount(trimmed.slice(1), currency, { allowNegative });
  if (SEPARATE_VALUES.test(trimmed)) return refuse('INVALID');
  // A space after the sign is dropped; a group space between digits is a thousands separator,
  // so it must group correctly; an ordinary space between digits is refused (`500 250`).
  const source = trimmed.replace(/^-\s+/, '-').replace(GROUP_SPACE, ',');
  const match = /^(-?)(\d[\d,]*)?(?:\.(\d*))?$/.exec(source);
  if (!match || (match[2] === undefined && !match[3])) return refuse('INVALID');
  const [, sign, integer = '0', fraction = ''] = match;
  if (integer.includes(',') && !GROUPED.test(integer)) return refuse('INVALID');
  const { exponent } = currencies[currency];
  if (fraction.length > exponent) return refuse('TOO_MANY_DECIMALS');
  const magnitude = BigInt(integer.replaceAll(',', '') + fraction.padEnd(exponent, '0'));
  if (sign && magnitude !== 0n && !allowNegative) return refuse('NEGATIVE_NOT_ALLOWED');
  return inRange(sign ? -magnitude : magnitude);
}

/** Longer expressions are refused: a calculator in a cell, not a programming language. */
const MAX_EXPRESSION = 200;

/**
 * An expression in major units (`100*3`, `(1250+750)/4`, `−12.5`): `+ − * / × ÷` and parentheses,
 * evaluated exactly as fractions and rounded once, half away from zero, to the currency's
 * exponent. Numbers here may carry more decimals than the currency (a rate); only the result is
 * rounded. The expression itself is not kept: the caller stores the amount.
 */
export function evaluateAmount(
  expression: string,
  currency: CurrencyCode,
  { allowNegative = true }: { allowNegative?: boolean } = {},
): AmountTextResult {
  const spaced = normalize(expression);
  // Space may sit around operators and parentheses, never inside a number (`1 2` is two numbers).
  if (SEPARATE_VALUES.test(spaced) || /[\d.]\s+[\d.]/.test(spaced)) return refuse('INVALID');
  const source = spaced.replace(/\s/g, '').replace(/×/g, '*').replace(/÷/g, '/');
  if (source === '') return refuse('EMPTY');
  if (source.length > MAX_EXPRESSION || !/^[\d.+\-*/()]+$/.test(source)) return refuse('INVALID');
  let at = 0;
  let divisionByZero = false;

  const number = (): Fraction | undefined => {
    const match = /^(\d+)(?:\.(\d+))?|^\.(\d+)/.exec(source.slice(at));
    if (!match) return undefined;
    at += match[0].length;
    const integer = match[1] ?? '0';
    const fraction = match[2] ?? match[3] ?? '';
    return { numerator: BigInt(integer + fraction), denominator: 10n ** BigInt(fraction.length) };
  };
  const factor = (): Fraction | undefined => {
    if (source[at] === '-' || source[at] === '+') {
      const negate = source[at] === '-';
      at += 1;
      const value = factor();
      return value && negate ? { ...value, numerator: -value.numerator } : value;
    }
    if (source[at] === '(') {
      at += 1;
      const value = sum();
      if (source[at] !== ')') return undefined;
      at += 1;
      return value;
    }
    return number();
  };
  const product = (): Fraction | undefined => {
    let value = factor();
    while (value && (source[at] === '*' || source[at] === '/')) {
      const divide = source[at] === '/';
      at += 1;
      const right = factor();
      if (!right) return undefined;
      if (divide && right.numerator === 0n) {
        divisionByZero = true;
        return undefined;
      }
      value = divide
        ? signed(value.numerator * right.denominator, value.denominator * right.numerator)
        : {
            numerator: value.numerator * right.numerator,
            denominator: value.denominator * right.denominator,
          };
    }
    return value;
  };
  const sum = (): Fraction | undefined => {
    let value = product();
    while (value && (source[at] === '+' || source[at] === '-')) {
      const subtract = source[at] === '-';
      at += 1;
      const right = product();
      if (!right) return undefined;
      const scaled = right.numerator * value.denominator;
      value = {
        numerator: value.numerator * right.denominator + (subtract ? -scaled : scaled),
        denominator: value.denominator * right.denominator,
      };
    }
    return value;
  };

  const result = sum();
  if (divisionByZero) return refuse('DIVISION_BY_ZERO');
  if (!result || at !== source.length) return refuse('INVALID');
  const { exponent } = currencies[currency];
  const amountMinor = divideHalfAwayFromZero(
    result.numerator * 10n ** BigInt(exponent),
    result.denominator,
  );
  if (amountMinor < 0n && !allowNegative) return refuse('NEGATIVE_NOT_ALLOWED');
  return inRange(amountMinor);
}

/** A fraction with its denominator made positive, as `divideHalfAwayFromZero()` requires. */
function signed(numerator: bigint, denominator: bigint): Fraction {
  return denominator < 0n
    ? { numerator: -numerator, denominator: -denominator }
    : { numerator, denominator };
}
