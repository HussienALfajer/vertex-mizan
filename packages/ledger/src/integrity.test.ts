import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type CanonicalValue,
  type ChainEntry,
  type ChainLink,
  canonicalJson,
  chainEntryValue,
  entryHash,
  storedRate,
  verifyChain,
} from './integrity.js';

describe('canonicalJson', () => {
  it('sorts keys, keeps no whitespace and writes integers in full', () => {
    expect(canonicalJson({ b: 1n, a: [true, null, 'x'], c: { z: -5, y: 'دفتر' } })).toBe(
      '{"a":[true,null,"x"],"b":1,"c":{"y":"دفتر","z":-5}}',
    );
    expect(canonicalJson(12_345_678_901_234_567_890n)).toBe('12345678901234567890');
    expect(canonicalJson(-(2n ** 63n - 1n))).toBe('-9223372036854775807');
    // A bigint and an equal safe integer serialise alike.
    expect(canonicalJson({ n: 7 })).toBe(canonicalJson({ n: 7n }));
  });

  it('escapes strings as JSON.stringify does and never normalises them', () => {
    expect(canonicalJson('a"b\\c\n\u0001')).toBe('"a\\"b\\\\c\\n\\u0001"');
    // é composed and decomposed are different stored strings, so they serialise differently.
    expect(canonicalJson('é')).not.toBe(canonicalJson('é'));
  });

  it('refuses values with no single form', () => {
    const refuse = (value: unknown) => () => canonicalJson(value as CanonicalValue);
    for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, undefined]) {
      expect(refuse(value)).toThrow(TypeError);
    }
    expect(refuse({ a: undefined })).toThrow(TypeError);
    // biome-ignore lint/suspicious/noSparseArray: the hole is the case under test
    expect(refuse([1, , 2])).toThrow(TypeError);
    expect(refuse(new Date('2026-11-03'))).toThrow(TypeError);
    expect(refuse(new Map())).toThrow(TypeError);
  });
});

describe('entryHash', () => {
  const entry = { number: 1, lines: [{ bookMinor: 1_200_000n, account: '1210' }] };

  it('is the SHA-256 of the canonical entry and previous hash, pinned so it never changes', () => {
    const canonical =
      '{"entry":{"lines":[{"account":"1210","bookMinor":1200000}],"number":1},"previousHash":null}';
    expect(entryHash(entry, null)).toBe(
      createHash('sha256').update(canonical, 'utf8').digest('hex'),
    );
    // A stored chain is verified with this serialisation for years: a change here breaks it.
    expect(entryHash(entry, null)).toBe(
      'baa61ab32c6409a83c72a60662a53b78750e9367e7f001829c86ce60189cb688',
    );
  });

  it('depends on content and the previous hash, not on key order', () => {
    const reordered = { lines: [{ account: '1210', bookMinor: 1_200_000n }], number: 1 };
    expect(entryHash(reordered, null)).toBe(entryHash(entry, null));
    expect(entryHash(entry, 'a'.repeat(64))).not.toBe(entryHash(entry, null));
    expect(entryHash({ ...entry, number: 2 }, null)).not.toBe(entryHash(entry, null));
  });
});

describe('verifyChain', () => {
  function chain(entries: readonly CanonicalValue[]): ChainLink[] {
    const links: ChainLink[] = [];
    let previousHash: string | null = null;
    for (const entry of entries) {
      const hash = entryHash(entry, previousHash);
      links.push({ entry, previousHash, hash });
      previousHash = hash;
    }
    return links;
  }
  const links = chain([{ number: 1 }, { number: 2 }, { number: 3 }]);

  it('holds for a chain built entry by entry', () => {
    expect(verifyChain(links)).toBe(null);
    expect(verifyChain([])).toBe(null);
  });

  it('finds the first altered, removed or reordered entry', () => {
    const [first, second, third] = links as [ChainLink, ChainLink, ChainLink];
    expect(verifyChain([first, { ...second, entry: { number: 20 } }, third])).toEqual({
      index: 1,
      reason: 'hash',
    });
    expect(verifyChain([first, third])).toEqual({ index: 1, reason: 'previous-hash' });
    expect(verifyChain([second, first, third])).toEqual({ index: 0, reason: 'previous-hash' });
    // A rewritten entry with a recomputed hash still breaks the next link.
    const rewritten = {
      ...second,
      entry: { number: 20 },
      hash: entryHash({ number: 20 }, first.hash),
    };
    expect(verifyChain([first, rewritten, third])).toEqual({ index: 2, reason: 'previous-hash' });
  });
});

describe('storedRate', () => {
  it('writes a rate as numeric(22,10) returns it', () => {
    expect(storedRate('122.5')).toBe('122.5000000000');
    expect(storedRate('121.5000')).toBe('121.5000000000');
    expect(storedRate('120')).toBe('120.0000000000');
    expect(storedRate('0.0083')).toBe('0.0083000000');
    expect(storedRate('007.25')).toBe('7.2500000000');
    expect(storedRate('41.5000000000')).toBe('41.5000000000');
  });

  it('refuses what is not a rate as quoted', () => {
    for (const rate of ['-1', '1.12345678901', '1e3', '', '.5', '1,5']) {
      expect(() => storedRate(rate)).toThrow(RangeError);
    }
  });
});

describe('chainEntryValue', () => {
  // A synthetic entry: 100.00 USD bought for 12,250.00 SYP at a dealt 122.5, Vertex Media's shape.
  const entry: ChainEntry = {
    id: '019a0000-0000-7000-8000-000000000001',
    companyId: '019a0000-0000-7000-8000-0000000000c1',
    requestId: '019a0000-0000-7000-8000-0000000000a1',
    sequence: 1n,
    fiscalYear: 2026,
    number: 1,
    entryDate: '2026-11-08',
    postedAt: '2026-11-08T09:30:00.000Z',
    source: 'manual',
    sourceRef: null,
    hubDocument: null,
    description: 'شراء دولار',
    reference: null,
    reversesEntryId: null,
    draftId: null,
    preparedByUserId: '019a0000-0000-7000-8000-0000000000b1',
    approvedByUserId: null,
    postedByUserId: '019a0000-0000-7000-8000-0000000000b1',
    postedByClientId: null,
    lines: [
      {
        lineNo: 2,
        accountId: '019a0000-0000-7000-8000-000000111003',
        dimensionKey: '',
        kind: 'measured',
        ledger: null,
        currency: 'SYP',
        amountMinor: -1_225_000n,
        bookMinor: -1_225_000n,
        parallelMinor: -10_000n,
        memo: null,
        conversions: [
          {
            ledger: 'parallel',
            basis: 'transaction',
            quoteNo: 1,
            rateId: null,
            base: 'USD',
            quote: 'SYP',
            rate: '122.5',
            rateType: 'market',
            rateSource: 'manual',
            effectiveOn: '2026-11-08',
          },
        ],
      },
      {
        lineNo: 1,
        accountId: '019a0000-0000-7000-8000-000000111004',
        dimensionKey: '',
        kind: 'measured',
        ledger: null,
        currency: 'USD',
        amountMinor: 10_000n,
        bookMinor: 1_215_000n,
        parallelMinor: 10_000n,
        memo: null,
        conversions: [
          {
            ledger: 'book',
            basis: 'policy',
            quoteNo: 1,
            rateId: '019a0000-0000-7000-8000-0000000000e1',
            base: 'USD',
            quote: 'SYP',
            rate: '121.5000000000',
            rateType: 'bulletin',
            rateSource: 'manual',
            effectiveOn: '2026-11-08',
          },
        ],
      },
      {
        lineNo: 3,
        accountId: '019a0000-0000-7000-8000-000000541001',
        dimensionKey: '',
        kind: 'difference',
        ledger: 'book',
        currency: 'SYP',
        amountMinor: 10_000n,
        bookMinor: 10_000n,
        parallelMinor: 0n,
        memo: null,
        conversions: [],
      },
    ],
  };

  it('hashes a stored entry as it hashed when posted, pinned so it never changes', () => {
    // A stored chain is verified with this value for at least ten years: a change here breaks it.
    expect(entryHash(chainEntryValue(entry), null)).toBe(
      '0ddb64c6584bdf669b6067a77fe68741ad34c752b2c8a64e1f6c4047ec568a94',
    );
  });

  it('reads lines in line order, conversions by ledger and quote, rates in their stored form', () => {
    const reordered: ChainEntry = {
      ...entry,
      lines: [...entry.lines].reverse().map((line) => ({
        ...line,
        conversions: line.conversions.map((conversion) => ({
          ...conversion,
          rate: storedRate(conversion.rate),
        })),
      })),
    };
    expect(canonicalJson(chainEntryValue(reordered))).toBe(canonicalJson(chainEntryValue(entry)));
  });

  it('changes with every field of the header, the lines and the conversions', () => {
    const base = canonicalJson(chainEntryValue(entry));
    const [first, ...others] = entry.lines;
    const line = first as ChainEntry['lines'][number];
    const conversion = line.conversions[0] as ChainEntry['lines'][number]['conversions'][number];
    const variants: ChainEntry[] = [
      { ...entry, id: '019a0000-0000-7000-8000-000000000002' },
      { ...entry, companyId: '019a0000-0000-7000-8000-0000000000c2' },
      { ...entry, requestId: '019a0000-0000-7000-8000-0000000000a2' },
      { ...entry, sequence: 2n },
      { ...entry, fiscalYear: 2027 },
      { ...entry, number: 2 },
      { ...entry, entryDate: '2026-11-09' },
      { ...entry, postedAt: '2026-11-08T09:30:00.001Z' },
      { ...entry, source: 'hub_event' },
      { ...entry, sourceRef: 'x' },
      { ...entry, hubDocument: { type: 'invoice' } },
      { ...entry, description: 'شراء دولار.' },
      { ...entry, reference: 'R-1' },
      { ...entry, reversesEntryId: '019a0000-0000-7000-8000-000000000003' },
      { ...entry, draftId: '019a0000-0000-7000-8000-0000000000d1' },
      { ...entry, preparedByUserId: null },
      { ...entry, approvedByUserId: '019a0000-0000-7000-8000-0000000000b2' },
      { ...entry, postedByUserId: null, postedByClientId: '019a0000-0000-7000-8000-0000000000f1' },
      ...(
        [
          { lineNo: 9 },
          { accountId: '019a0000-0000-7000-8000-000000111005' },
          { dimensionKey: 'a:b' },
          { kind: 'carried' },
          { ledger: 'book' },
          { currency: 'EUR' },
          { amountMinor: 10_001n },
          { bookMinor: 1_215_001n },
          { parallelMinor: null },
          { memo: 'm' },
          { conversions: [] },
          { conversions: [{ ...conversion, rate: '121.6' }] },
          { conversions: [{ ...conversion, rateId: '019a0000-0000-7000-8000-0000000000e2' }] },
          { conversions: [{ ...conversion, basis: 'policy' }] },
          { conversions: [{ ...conversion, quoteNo: 2 }] },
          { conversions: [{ ...conversion, rateType: 'bulletin' }] },
          { conversions: [{ ...conversion, rateSource: 'hub' }] },
          { conversions: [{ ...conversion, effectiveOn: '2026-11-05' }] },
          { conversions: [{ ...conversion, base: 'SYP', quote: 'USD' }] },
        ] as Partial<ChainEntry['lines'][number]>[]
      ).map((change) => ({ ...entry, lines: [{ ...line, ...change }, ...others] })),
      { ...entry, lines: others },
    ];
    for (const [index, variant] of variants.entries()) {
      expect(canonicalJson(chainEntryValue(variant)), `variant ${index}`).not.toBe(base);
    }
  });

  it('refuses a posting time that is not UTC with milliseconds', () => {
    expect(() => chainEntryValue({ ...entry, postedAt: '2026-11-08T09:30:00Z' })).toThrow(
      RangeError,
    );
  });
});
