import { amountParts, type CurrencyCode } from '@vertex-mizan/contracts';

/**
 * An amount in Arabic words, as a printed voucher states it (S11 "Printing and legal books"):
 * "فقط ألف وخمسمئة دولار أمريكي لا غير". The counted noun agrees with the number in Arabic's way:
 * one and two are the noun with "واحد" or its dual, 3–10 take the plural with the number in the
 * opposite gender, 11–99 the accusative singular, and round hundreds and scales the genitive
 * singular. The number's last group decides the noun's form. SYP is the new pound, as printed
 * (ADR 0007). The amount is read through the money module's `amountParts()`, never as a float.
 */

type Gender = 'masculine' | 'feminine';

/** A counted noun's forms by the number before it. */
interface CountedNoun {
  readonly gender: Gender;
  /** Exactly one, alone: the noun with "واحد" after it. */
  readonly one: string;
  /** Exactly two, alone: the dual. */
  readonly two: string;
  /** 3–10: the plural. */
  readonly few: string;
  /** 11–99: the accusative singular. */
  readonly many: string;
  /** Round hundreds, scales and after "واحد"/"اثنان" in a longer number: the genitive singular. */
  readonly genitive: string;
}

interface CurrencyWords {
  readonly unit: CountedNoun;
  readonly subunit: CountedNoun;
}

const cent: CountedNoun = {
  gender: 'masculine',
  one: 'سنت واحد',
  two: 'سنتان',
  few: 'سنتات',
  many: 'سنتاً',
  genitive: 'سنت',
};

const piastre: CountedNoun = {
  gender: 'masculine',
  one: 'قرش واحد',
  two: 'قرشان',
  few: 'قروش',
  many: 'قرشاً',
  genitive: 'قرش',
};

/** Each currency's unit and sub-unit (S11: دولار أمريكي / سنت، ليرة سورية جديدة / قرش، ليرة تركية / قرش). */
export const currencyWords = {
  USD: {
    unit: {
      gender: 'masculine',
      one: 'دولار أمريكي واحد',
      two: 'دولاران أمريكيان',
      few: 'دولارات أمريكية',
      many: 'دولاراً أمريكياً',
      genitive: 'دولار أمريكي',
    },
    subunit: cent,
  },
  SYP: {
    unit: {
      gender: 'feminine',
      one: 'ليرة سورية جديدة واحدة',
      two: 'ليرتان سوريتان جديدتان',
      few: 'ليرات سورية جديدة',
      many: 'ليرة سورية جديدة',
      genitive: 'ليرة سورية جديدة',
    },
    subunit: piastre,
  },
  TRY: {
    unit: {
      gender: 'feminine',
      one: 'ليرة تركية واحدة',
      two: 'ليرتان تركيتان',
      few: 'ليرات تركية',
      many: 'ليرة تركية',
      genitive: 'ليرة تركية',
    },
    subunit: piastre,
  },
  EUR: {
    unit: {
      gender: 'masculine',
      one: 'يورو واحد',
      two: 'اثنان يورو',
      few: 'يورو',
      many: 'يورو',
      genitive: 'يورو',
    },
    subunit: cent,
  },
} as const satisfies Record<CurrencyCode, CurrencyWords>;

interface Scale extends CountedNoun {
  /** The dual before a noun, its nūn dropped: ألفا دولار. */
  readonly construct: string;
}

function scale(one: string, two: string, few: string, many: string): Scale {
  return { gender: 'masculine', one, two, few, many, genitive: one, construct: two.slice(0, -1) };
}

/** Thousands and up, by group of three digits (index 1 is thousands). */
const scales: readonly Scale[] = [
  scale('ألف', 'ألفان', 'آلاف', 'ألفاً'),
  scale('مليون', 'مليونان', 'ملايين', 'مليوناً'),
  scale('مليار', 'ملياران', 'مليارات', 'ملياراً'),
  scale('تريليون', 'تريليونان', 'تريليونات', 'تريليوناً'),
  scale('كوادريليون', 'كوادريليونان', 'كوادريليونات', 'كوادريليوناً'),
];

/** 3–10 in the gender opposite to the counted noun's. */
const unitsForMasculine = [
  '',
  '',
  '',
  'ثلاثة',
  'أربعة',
  'خمسة',
  'ستة',
  'سبعة',
  'ثمانية',
  'تسعة',
  'عشرة',
];
const unitsForFeminine = ['', '', '', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثماني', 'تسع', 'عشر'];
const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const hundreds = [
  '',
  'مئة',
  'مئتان',
  'ثلاثمئة',
  'أربعمئة',
  'خمسمئة',
  'ستمئة',
  'سبعمئة',
  'ثمانمئة',
  'تسعمئة',
];

function oneWord(gender: Gender): string {
  return gender === 'masculine' ? 'واحد' : 'واحدة';
}

function twoWord(gender: Gender): string {
  return gender === 'masculine' ? 'اثنان' : 'اثنتان';
}

function unit(value: number, gender: Gender): string {
  return (gender === 'masculine' ? unitsForMasculine : unitsForFeminine)[value] ?? '';
}

/** 11–99 without the noun. */
function elevenToNinetyNine(value: number, gender: Gender): string {
  const masculine = gender === 'masculine';
  if (value === 11) return masculine ? 'أحد عشر' : 'إحدى عشرة';
  if (value === 12) return masculine ? 'اثنا عشر' : 'اثنتا عشرة';
  const ones = value % 10;
  const ten = Math.floor(value / 10);
  if (value < 20) return `${unit(ones, gender)} ${masculine ? 'عشر' : 'عشرة'}`;
  const tensWord = tens[ten] ?? '';
  if (ones === 0) return tensWord;
  const onesWord =
    ones === 1 ? (masculine ? 'واحد' : 'إحدى') : ones === 2 ? twoWord(gender) : unit(ones, gender);
  return `${onesWord} و${tensWord}`;
}

/**
 * A group of three digits (1–999) with its counted noun. `alone` is true when the group is the
 * whole number, so one and two take the noun's own forms ("دولار أمريكي واحد", "ألفان").
 */
function group(value: number, noun: CountedNoun, alone: boolean): string {
  const { gender } = noun;
  if (value === 1 && alone) return noun.one;
  if (value === 2 && alone) return noun.two;
  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  if (rest === 0) {
    // The dual hundred loses its nūn before the noun: "مئتا دولار".
    const word = hundred === 2 ? 'مئتا' : (hundreds[hundred] ?? '');
    return `${word} ${noun.genitive}`;
  }
  const prefix = hundred > 0 ? `${hundreds[hundred]} و` : '';
  if (rest === 1) return `${prefix}${oneWord(gender)} ${noun.genitive}`;
  if (rest === 2) return `${prefix}${twoWord(gender)} ${noun.genitive}`;
  if (rest <= 10) return `${prefix}${unit(rest, gender)} ${noun.few}`;
  return `${prefix}${elevenToNinetyNine(rest, gender)} ${noun.many}`;
}

/** A whole number of `noun`, from its groups of three digits, most significant first. */
function wholeInWords(groups: readonly number[], noun: CountedNoun): string {
  const parts: string[] = [];
  const nonZero = groups.filter((value) => value > 0).length;
  groups.forEach((value, index) => {
    if (value === 0) return;
    const position = groups.length - 1 - index;
    if (position === 0) {
      parts.push(group(value, noun, nonZero === 1));
      return;
    }
    const scaleNoun = scales[position - 1];
    if (!scaleNoun) throw new RangeError('The amount is beyond the scales of amountInWords.');
    // A scale's one and two are always its own forms: "ألف", "ألفان", "مليون وألف". When the
    // counted noun follows it directly, it is in construct: "ألفا دولار", "أحد عشر ألف دولار".
    const beforeNoun = groups.slice(index + 1).every((later) => later === 0);
    const form = beforeNoun
      ? { ...scaleNoun, two: scaleNoun.construct, many: scaleNoun.genitive }
      : scaleNoun;
    parts.push(group(value, form, true));
  });
  const words = parts.join(' و');
  // The noun follows the last group; when that group is zero it is the genitive: "ألف دولار".
  const last = groups[groups.length - 1] ?? 0;
  return last === 0 ? `${words} ${noun.genitive}` : words;
}

/**
 * `amountInWords(150000n, 'USD')` is "فقط ألف وخمسمئة دولار أمريكي لا غير". The amount is in minor
 * units and not negative: a voucher states an amount, its direction is the voucher's kind.
 */
export function amountInWords(minor: bigint, currency: CurrencyCode): string {
  const { negative, groups, fraction } = amountParts(minor, currency);
  if (negative) throw new RangeError('amountInWords takes an amount that is not negative.');
  const words = currencyWords[currency];
  const whole = groups.map(Number);
  const subunits = fraction ? Number(fraction) : 0;
  const hasWhole = whole.some((value) => value > 0);
  const phrases: string[] = [];
  if (hasWhole) phrases.push(wholeInWords(whole, words.unit));
  if (subunits > 0) phrases.push(wholeInWords([subunits], words.subunit));
  if (phrases.length === 0) phrases.push(`صفر ${words.unit.genitive}`);
  return `فقط ${phrases.join(' و')} لا غير`;
}
