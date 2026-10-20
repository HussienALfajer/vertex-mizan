import { createHash } from 'node:crypto';

/**
 * The integrity chain (ADR 0005): every posted entry stores the SHA-256 of a canonical
 * serialisation of its content and of the previous entry's hash, so recomputing the chain from
 * the start finds the first entry altered after posting. Copied from Hub's `payloadHash` and
 * adapted. This file holds the package's one Node import: `node:crypto` for SHA-256.
 */

/** A value the canonical serialisation accepts: JSON without fractions, integers in full. */
export type CanonicalValue =
  | null
  | boolean
  | string
  | bigint
  | number
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

/** `Array.isArray` with readonly arrays narrowed out of the other branch. */
function isList(value: CanonicalValue): value is readonly CanonicalValue[] {
  return Array.isArray(value);
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * The canonical serialisation: JSON with no whitespace, object keys sorted by UTF-16 code units
 * (as RFC 8785), strings escaped as `JSON.stringify` escapes them, and integers written in full,
 * so a `bigint` and an equal safe-integer `number` serialise alike. Strings are hashed as stored,
 * never normalised. Refused (`TypeError`), because they have no single form: fractional, unsafe or
 * non-finite numbers, `undefined`, array holes, and objects other than plain objects and arrays
 * (a `Date` is passed as its ISO string).
 */
export function canonicalJson(value: CanonicalValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError(`No canonical form for ${value}`);
    return BigInt(value).toString();
  }
  const absent = (at: string) =>
    new TypeError(`No canonical form for undefined or a hole at ${at}`);
  if (isList(value)) {
    const items: readonly (CanonicalValue | undefined)[] = value;
    // A hole reads as undefined: indexing, unlike map(), visits it.
    return `[${Array.from({ length: items.length }, (_, index) => {
      const item = items[index];
      if (item === undefined) throw absent(String(index));
      return canonicalJson(item);
    }).join(',')}]`;
  }
  if (typeof value !== 'object' || !isPlainObject(value)) {
    throw new TypeError(`No canonical form for a ${typeof value}`);
  }
  const members: { readonly [key: string]: CanonicalValue | undefined } = value;
  return `{${Object.keys(members)
    .sort()
    .map((key) => {
      const member = members[key];
      if (member === undefined) throw absent(key);
      return `${JSON.stringify(key)}:${canonicalJson(member)}`;
    })
    .join(',')}}`;
}

/**
 * The hash of a posted entry: SHA-256, as 64 lowercase hex digits, of the canonical serialisation
 * of `{ entry, previousHash }`, where `entry` is its header, lines and dimensions as stored and
 * `previousHash` the hash of the company's previous entry (null for its first).
 */
export function entryHash(entry: CanonicalValue, previousHash: string | null): string {
  return createHash('sha256').update(canonicalJson({ entry, previousHash }), 'utf8').digest('hex');
}

/** One posted entry of a company's chain, as stored. */
export interface ChainLink {
  readonly entry: CanonicalValue;
  readonly previousHash: string | null;
  readonly hash: string;
}

/** Where a chain first breaks: the link's index, and whether its link back or its hash fails. */
export interface ChainBreak {
  readonly index: number;
  readonly reason: 'previous-hash' | 'hash';
}

/**
 * Recomputes a company's chain from its first entry, in posting order, and returns the first
 * break: a link whose previous hash is not the hash before it (null for the first), or whose hash
 * is not the hash of its content. Null when every link holds.
 */
export function verifyChain(chain: readonly ChainLink[]): ChainBreak | null {
  let previous: string | null = null;
  for (const [index, link] of chain.entries()) {
    if (link.previousHash !== previous) return { index, reason: 'previous-hash' };
    if (entryHash(link.entry, link.previousHash) !== link.hash) return { index, reason: 'hash' };
    previous = link.hash;
  }
  return null;
}
