import { createHash } from 'node:crypto';
import type { CurrencyCode, Ledger, RateSource, RateType } from '@vertex-mizan/contracts';
import type { Line } from './lines.js';
import type { EntrySource } from './manual.js';

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

/** How one ledger amount of a posted line was converted, as stored (`line_conversions`). */
export interface ChainConversion {
  readonly ledger: Ledger;
  readonly basis: 'policy' | 'transaction';
  /** 1, or 1 and 2 for the two quotes of a cross rate. */
  readonly quoteNo: number;
  /** The rate row; null for a transaction's own or a dealt rate, which is not in the rate table. */
  readonly rateId: string | null;
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
  /** As quoted, or as stored: it is hashed in its stored `numeric(22,10)` form (`storedRate`). */
  readonly rate: string;
  readonly rateType: RateType;
  readonly rateSource: RateSource;
  readonly effectiveOn: string;
}

/** A posted line, as stored (`journal_lines`), with its conversions. */
export interface ChainLine {
  readonly lineNo: number;
  readonly accountId: string;
  /** Its dimension set's key: the set's `type:value` ids, sorted; `''` for none. */
  readonly dimensionKey: string;
  readonly kind: Line['kind'];
  /** The one ledger of a difference or rounding line; null on the others. */
  readonly ledger: Ledger | null;
  readonly currency: CurrencyCode;
  readonly amountMinor: bigint;
  readonly bookMinor: bigint;
  readonly parallelMinor: bigint | null;
  readonly memo: string | null;
  readonly conversions: readonly ChainConversion[];
}

/**
 * A posted entry, as stored (`journal_entries`), with its lines: what its hash covers. The
 * attachments are not part of it: they change no amount (S03 rule 17).
 */
export interface ChainEntry {
  readonly id: string;
  readonly companyId: string;
  readonly requestId: string;
  /** Its place in the company's chain: 1 for the first entry. */
  readonly sequence: bigint;
  readonly fiscalYear: number;
  readonly number: number;
  readonly entryDate: string;
  /** The posting time, ISO 8601 in UTC with milliseconds (`2026-11-08T09:30:00.000Z`). */
  readonly postedAt: string;
  readonly source: EntrySource;
  readonly sourceRef: string | null;
  readonly hubDocument: CanonicalValue;
  readonly description: string;
  readonly reference: string | null;
  readonly reversesEntryId: string | null;
  readonly draftId: string | null;
  readonly preparedByUserId: string | null;
  readonly approvedByUserId: string | null;
  readonly postedByUserId: string | null;
  readonly postedByClientId: string | null;
  readonly lines: readonly ChainLine[];
}

/**
 * A rate in the form a `numeric(22,10)` column stores and returns it: ten decimals, no leading
 * zeros (`122.5` → `122.5000000000`), so a rate as quoted and as read back hash alike. Refuses
 * what is not a positive decimal of up to ten places (`RangeError`).
 */
export function storedRate(rate: string): string {
  const match = /^(\d+)(?:\.(\d{1,10}))?$/.exec(rate);
  if (match === null) throw new RangeError(`Not a rate as quoted: ${rate}`);
  const whole = (match[1] as string).replace(/^0+(?=\d)/, '');
  return `${whole}.${(match[2] ?? '').padEnd(10, '0')}`;
}

const LEDGER_ORDER: Record<Ledger, number> = { book: 0, parallel: 1 };

const POSTED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The hashed value of a posted entry (S03 rule 18, ADR 0005): its header, and its lines in line
 * order, each with its conversions by ledger and quote. The posting function and the integrity
 * check both build it from the same typed fields, so a stored entry hashes as it did when posted:
 * amounts are `bigint`, rates in their stored form, the posting time in milliseconds. Never change
 * it once an entry is posted: `integrity.test.ts` pins it.
 */
export function chainEntryValue(entry: ChainEntry): CanonicalValue {
  if (!POSTED_AT.test(entry.postedAt)) {
    throw new RangeError(`A posting time in UTC with milliseconds, not ${entry.postedAt}`);
  }
  const lines = [...entry.lines].sort((a, b) => a.lineNo - b.lineNo);
  return {
    id: entry.id,
    companyId: entry.companyId,
    requestId: entry.requestId,
    sequence: entry.sequence,
    fiscalYear: entry.fiscalYear,
    number: entry.number,
    entryDate: entry.entryDate,
    postedAt: entry.postedAt,
    source: entry.source,
    sourceRef: entry.sourceRef,
    hubDocument: entry.hubDocument,
    description: entry.description,
    reference: entry.reference,
    reversesEntryId: entry.reversesEntryId,
    draftId: entry.draftId,
    preparedByUserId: entry.preparedByUserId,
    approvedByUserId: entry.approvedByUserId,
    postedByUserId: entry.postedByUserId,
    postedByClientId: entry.postedByClientId,
    lines: lines.map((line) => ({
      lineNo: line.lineNo,
      accountId: line.accountId,
      dimensionKey: line.dimensionKey,
      kind: line.kind,
      ledger: line.ledger,
      currency: line.currency,
      amountMinor: line.amountMinor,
      bookMinor: line.bookMinor,
      parallelMinor: line.parallelMinor,
      memo: line.memo,
      conversions: [...line.conversions]
        .sort((a, b) => LEDGER_ORDER[a.ledger] - LEDGER_ORDER[b.ledger] || a.quoteNo - b.quoteNo)
        .map((conversion) => ({
          ledger: conversion.ledger,
          basis: conversion.basis,
          quoteNo: conversion.quoteNo,
          rateId: conversion.rateId,
          base: conversion.base,
          quote: conversion.quote,
          rate: storedRate(conversion.rate),
          rateType: conversion.rateType,
          rateSource: conversion.rateSource,
          effectiveOn: conversion.effectiveOn,
        })),
    })),
  };
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
