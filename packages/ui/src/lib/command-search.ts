/*
 * How the command palette finds a command (ADR 0010 §4): Arabic text is compared the way people
 * type it, so a search never fails on a diacritic, a hamza or the digits an Arabic keyboard types.
 */

/** Text as the search compares it. */
export function normalizeSearchText(text: string): string {
  return (
    text
      .normalize('NFC')
      // Diacritics (tashkeel), the superscript alef and the tatweel never change a word.
      .replace(/[ً-ٰٟـ]/g, '')
      // Alef with hamza or madda, and alef wasla, are typed as a bare alef.
      .replace(/[آأإٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .toLocaleLowerCase('en')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** What a command is found by: its label and any other words (an English name, a code). */
export interface Searchable {
  readonly label: string;
  readonly keywords?: readonly string[] | undefined;
}

/** Whether every word of the query appears in the command's label or keywords, in any order. */
export function matchesCommand({ label, keywords = [] }: Searchable, query: string): boolean {
  const haystack = normalizeSearchText([label, ...keywords].join(' '));
  return normalizeSearchText(query)
    .split(' ')
    .every((word) => haystack.includes(word));
}
