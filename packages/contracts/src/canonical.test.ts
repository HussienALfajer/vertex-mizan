import { describe, expect, it } from 'vitest';
import { canonicalPayload } from './canonical.js';

describe('canonicalPayload (RFC 8785)', () => {
  it('sorts keys, drops undefined members and writes no whitespace', () => {
    expect(canonicalPayload({ b: [1, 'x', null], a: { d: true, c: undefined } })).toBe(
      '{"a":{"d":true},"b":[1,"x",null]}',
    );
    expect(canonicalPayload({ é: 1, z: 2, Z: 3 })).toBe('{"Z":3,"z":2,"é":1}');
  });

  it('refuses what JSON cannot hold exactly', () => {
    expect(() => canonicalPayload(Number.NaN)).toThrow(RangeError);
    expect(() => canonicalPayload(1n)).toThrow(TypeError);
  });
});
