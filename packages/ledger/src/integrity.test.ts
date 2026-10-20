import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type CanonicalValue,
  type ChainLink,
  canonicalJson,
  entryHash,
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
