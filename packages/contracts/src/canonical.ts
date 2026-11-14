/**
 * A value's canonical JSON form (RFC 8785): object keys sorted by UTF-16 code units, no whitespace,
 * strings and integers as JSON writes them, `undefined` members left out. Its SHA-256 is the
 * content hash of the journal book's official print (S09 rule 30); it was Hub's payload hash before
 * ADR 0021 and never changes. A value holds no float.
 */
export function canonicalPayload(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('A payload number is finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalPayload).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalPayload(item)}`).join(',')}}`;
  }
  throw new TypeError(`A payload holds no ${typeof value}`);
}
