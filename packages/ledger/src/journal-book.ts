import { JOURNAL_BOOK_COLUMNS, JOURNAL_BOOK_ROWS_PER_PAGE } from '@vertex-mizan/contracts';
import { periodOf } from './periods.js';

/**
 * The journal book's pages (S09 rules 26, 27, 31): Mizan paginates, not the browser. Each entry
 * takes one header row, continuation rows for a long description or reference, then a row per
 * line with continuation rows for a long name or memo; text splits at word boundaries at the
 * column widths of `JOURNAL_BOOK_COLUMNS`. A page holds `JOURNAL_BOOK_ROWS_PER_PAGE` rows, each
 * month starts on a new page, and an entry that runs on opens the next page with "تابع القيد رقم
 * n". Pages are numbered from the fiscal year's first entry, so a month printed alone has the
 * page numbers and totals it has in the year's print. Amounts are the book ledger's.
 */

export interface JournalBookEntryInput {
  readonly fiscalYear: number;
  readonly number: number;
  readonly entryDate: string;
  readonly description: string;
  readonly reference: string | null;
  readonly lines: readonly {
    readonly accountCode: string;
    readonly accountName: string;
    readonly memo: string | null;
    /** The book amount, positive debit. */
    readonly amount: bigint;
  }[];
}

export type JournalBookRowValue =
  | {
      readonly kind: 'entry';
      readonly fiscalYear: number;
      readonly number: number;
      readonly entryDate: string;
      readonly description: string;
      readonly reference: string | null;
    }
  | {
      readonly kind: 'entry_text';
      readonly number: number;
      readonly description: string | null;
      readonly reference: string | null;
    }
  | { readonly kind: 'continued'; readonly number: number }
  | {
      readonly kind: 'line';
      readonly number: number;
      readonly accountCode: string;
      readonly accountName: string;
      readonly memo: string | null;
      readonly debit: bigint;
      readonly credit: bigint;
    }
  | {
      readonly kind: 'line_text';
      readonly number: number;
      readonly accountName: string | null;
      readonly memo: string | null;
    };

export interface DebitsCreditsTotals {
  readonly debits: bigint;
  readonly credits: bigint;
}

export interface JournalBookPageValue {
  readonly page: number;
  readonly month: string;
  readonly rows: readonly JournalBookRowValue[];
  readonly totals: DebitsCreditsTotals;
  readonly broughtForward: DebitsCreditsTotals;
  readonly cumulative: DebitsCreditsTotals;
}

/**
 * A text cut into pieces of at most `width` characters at word boundaries; a word longer than
 * the width is cut where the width ends. Empty text is one empty piece.
 */
export function wrapText(text: string, width: number): string[] {
  if (!Number.isInteger(width) || width < 1) throw new RangeError(`A width of ${width}`);
  const words = text.split(/\s+/).filter((word) => word !== '');
  const pieces: string[] = [];
  let current = '';
  const length = (value: string) => Array.from(value).length;
  for (const word of words) {
    let rest = word;
    while (length(rest) > width) {
      if (current !== '') {
        pieces.push(current);
        current = '';
      }
      const characters = Array.from(rest);
      pieces.push(characters.slice(0, width).join(''));
      rest = characters.slice(width).join('');
    }
    if (rest === '') continue;
    if (current === '') current = rest;
    else if (length(current) + 1 + length(rest) <= width) current = `${current} ${rest}`;
    else {
      pieces.push(current);
      current = rest;
    }
  }
  pieces.push(current);
  return pieces;
}

/** The rows of one entry, in order: its header and continuations, then its lines. */
export function journalBookEntryRows(entry: JournalBookEntryInput): JournalBookRowValue[] {
  const description = wrapText(entry.description, JOURNAL_BOOK_COLUMNS.description);
  const reference =
    entry.reference === null ? [] : wrapText(entry.reference, JOURNAL_BOOK_COLUMNS.reference);
  const rows: JournalBookRowValue[] = [
    {
      kind: 'entry',
      fiscalYear: entry.fiscalYear,
      number: entry.number,
      entryDate: entry.entryDate,
      description: description[0] ?? '',
      reference: reference[0] ?? null,
    },
  ];
  for (let index = 1; index < Math.max(description.length, reference.length); index += 1) {
    rows.push({
      kind: 'entry_text',
      number: entry.number,
      description: description[index] ?? null,
      reference: reference[index] ?? null,
    });
  }
  for (const line of entry.lines) {
    const name = wrapText(line.accountName, JOURNAL_BOOK_COLUMNS.accountName);
    const memo = line.memo === null ? [] : wrapText(line.memo, JOURNAL_BOOK_COLUMNS.memo);
    rows.push({
      kind: 'line',
      number: entry.number,
      accountCode: line.accountCode,
      accountName: name[0] ?? '',
      memo: memo[0] ?? null,
      debit: line.amount > 0n ? line.amount : 0n,
      credit: line.amount < 0n ? -line.amount : 0n,
    });
    for (let index = 1; index < Math.max(name.length, memo.length); index += 1) {
      rows.push({
        kind: 'line_text',
        number: entry.number,
        accountName: name[index] ?? null,
        memo: memo[index] ?? null,
      });
    }
  }
  return rows;
}

const ZERO: DebitsCreditsTotals = { debits: 0n, credits: 0n };

const plus = (a: DebitsCreditsTotals, b: DebitsCreditsTotals): DebitsCreditsTotals => ({
  debits: a.debits + b.debits,
  credits: a.credits + b.credits,
});

/**
 * The pages of a fiscal year's journal book for the months `from` to `to` (`YYYY-MM`). `entries`
 * are the fiscal year's posted entries from its start to the end of `to`, in `(entry_date,
 * number)` order: the earlier months are paginated too, so the range's first page has its number
 * and brought-forward totals in the year. An empty month has no page.
 */
export function journalBookPages(
  entries: readonly JournalBookEntryInput[],
  range: { readonly from: string; readonly to: string },
): JournalBookPageValue[] {
  const pages: JournalBookPageValue[] = [];
  let carried = ZERO;
  let page: { month: string; rows: JournalBookRowValue[]; totals: DebitsCreditsTotals } | null =
    null;
  const close = () => {
    if (page === null) return;
    pages.push({
      page: pages.length + 1,
      month: page.month,
      rows: page.rows,
      totals: page.totals,
      broughtForward: carried,
      cumulative: plus(carried, page.totals),
    });
    carried = plus(carried, page.totals);
    page = null;
  };
  let previous: JournalBookEntryInput | null = null;
  for (const entry of entries) {
    const month = periodOf(entry.entryDate);
    if (month > range.to) break;
    if (
      previous !== null &&
      (previous.entryDate > entry.entryDate ||
        (previous.entryDate === entry.entryDate && previous.number >= entry.number))
    ) {
      throw new RangeError('The journal book reads entries in (entry_date, number) order');
    }
    previous = entry;
    // Each month starts on a new page.
    if (page !== null && page.month !== month) close();
    for (const row of journalBookEntryRows(entry)) {
      if (page !== null && page.rows.length === JOURNAL_BOOK_ROWS_PER_PAGE) {
        close();
        // The entry runs on: the next page opens with "تابع القيد رقم n".
        if (row.kind !== 'entry') {
          page = { month, rows: [{ kind: 'continued', number: entry.number }], totals: ZERO };
        }
      }
      page ??= { month, rows: [], totals: ZERO };
      page.rows.push(row);
      if (row.kind === 'line') {
        page.totals = plus(page.totals, { debits: row.debit, credits: row.credit });
      }
    }
  }
  close();
  return pages.filter((candidate) => candidate.month >= range.from && candidate.month <= range.to);
}
