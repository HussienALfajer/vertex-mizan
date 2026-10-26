import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseTsv, toHtmlTable, toTsv } from './tsv';

describe('toTsv', () => {
  it('writes tab-separated rows with CRLF, quoting only cells that need it', () => {
    expect(
      toTsv([
        ['حساب', '-1250.50'],
        ['1100', '0.00'],
      ]),
    ).toBe('حساب\t-1250.50\r\n1100\t0.00\r\n');
    expect(toTsv([['a\tb', 'line\nbreak', '"quoted"', 'say "hi"']])).toBe(
      '"a\tb"\t"line\nbreak"\t"""quoted"""\tsay "hi"\r\n',
    );
  });
});

describe('parseTsv', () => {
  it('reads what Excel writes, with or without the final line break', () => {
    expect(parseTsv('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseTsv('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseTsv('a\rb')).toEqual([['a'], ['b']]);
    expect(parseTsv('a\t\r\n')).toEqual([['a', '']]);
  });

  it('distinguishes no text from one empty cell', () => {
    expect(parseTsv('')).toEqual([]);
    expect(parseTsv('\r\n')).toEqual([['']]);
    expect(parseTsv('\r\n\r\n')).toEqual([[''], ['']]);
  });

  it('accepts quoted cells, and quotes that do not close a cell as plain text', () => {
    expect(parseTsv('"two\r\nlines"\tx\r\n')).toEqual([['two\r\nlines', 'x']]);
    expect(parseTsv('"say ""hi"""\r\n')).toEqual([['say "hi"']]);
    // Excel does not always quote: these are plain text.
    expect(parseTsv('"5" inches\tx')).toEqual([['"5" inches', 'x']]);
    expect(parseTsv('"open\tx\ny')).toEqual([['"open', 'x'], ['y']]);
    expect(parseTsv('a "b" c')).toEqual([['a "b" c']]);
  });

  it('reads back exactly what it wrote, for any rectangular rows (property)', () => {
    const cell = fc.string({
      unit: fc.constantFrom('a', 'ب', '1', '"', '\t', '\r', '\n', ' ', '-'),
    });
    const rows = fc
      .tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 5 }))
      .chain(([height, width]) =>
        fc.array(fc.array(cell, { minLength: width, maxLength: width }), {
          minLength: height,
          maxLength: height,
        }),
      );
    fc.assert(
      fc.property(rows, (written) => {
        expect(parseTsv(toTsv(written))).toEqual(written);
      }),
    );
  });
});

describe('toHtmlTable', () => {
  it('escapes markup and keeps line breaks', () => {
    expect(toHtmlTable([['<b>&"x"</b>', 'a\nb']])).toBe(
      '<table><tr><td>&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;</td><td>a<br>b</td></tr></table>',
    );
  });
});
