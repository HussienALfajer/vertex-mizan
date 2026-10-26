import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { matchesCommand, normalizeSearchText } from './command-search';

const DIACRITICS = ['ً', 'َ', 'ُ', 'ِ', 'ّ', 'ْ', 'ـ'];

/** Arabic and Latin words, as command labels are made of. */
const word = fc.string({
  minLength: 1,
  maxLength: 8,
  unit: fc.constantFrom('ق', 'ي', 'د', 'ج', 'ا', 'أ', 'إ', 'ة', 'ى', 'م', 'ن', 'a', 'B', '1', '٣'),
});
const label = fc.array(word, { minLength: 1, maxLength: 4 }).map((words) => words.join(' '));

describe('normalizeSearchText', () => {
  it('drops diacritics and folds hamza forms, alef maqsura, taa marbuta and digits', () => {
    expect(normalizeSearchText('  قَيْدٌ   جديـــد ')).toBe('قيد جديد');
    expect(normalizeSearchText('إقفال الفترة')).toBe(normalizeSearchText('اقفال الفتره'));
    expect(normalizeSearchText('مستوى')).toBe('مستوي');
    expect(normalizeSearchText('حساب ١٢٠٠')).toBe('حساب 1200');
    expect(normalizeSearchText('Trial Balance')).toBe('trial balance');
  });
});

describe('matchesCommand', () => {
  const command = { label: 'ميزان المراجعة', keywords: ['Trial balance', 'TB'] };

  it('finds a command by any words of its label or keywords, in any order', () => {
    expect(matchesCommand(command, '')).toBe(true);
    expect(matchesCommand(command, 'المراجعة ميزان')).toBe(true);
    expect(matchesCommand(command, 'مراج')).toBe(true);
    expect(matchesCommand(command, 'trial')).toBe(true);
    expect(matchesCommand(command, 'ميزان tb')).toBe(true);
    expect(matchesCommand(command, 'ميزان قيد')).toBe(false);
  });

  it('always finds a command by its own label, however it is written (property)', () => {
    fc.assert(
      fc.property(label, fc.array(fc.constantFrom(...DIACRITICS)), (text, marks) => {
        // The query as typed with diacritics scattered after its letters.
        const decorated = [...text].map((ch, i) => ch + (marks[i] ?? '')).join('');
        expect(matchesCommand({ label: text }, decorated)).toBe(true);
        expect(matchesCommand({ label: decorated }, text)).toBe(true);
      }),
    );
  });

  it('never finds a command with a query word that is nowhere in it (property)', () => {
    fc.assert(
      fc.property(label, label, (text, query) => {
        const absent = normalizeSearchText(query)
          .split(' ')
          .some((w) => !normalizeSearchText(text).includes(w));
        expect(matchesCommand({ label: text }, query)).toBe(!absent);
      }),
    );
  });
});
