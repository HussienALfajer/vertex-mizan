import type { ExpectedBalance, ExpectedEntry } from './format.js';
import type { BalanceQuery, ObservedBalance, PostedEntry, PostedLine } from './harness.js';

function describeDimensions(dims: Readonly<Record<string, string>>): string {
  const pairs = Object.entries(dims).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return pairs.length === 0
    ? ''
    : ` {${pairs.map(([name, value]) => `${name}: ${value}`).join(', ')}}`;
}

export function describeLine(line: PostedLine): string {
  const parallel = line.parallel === null ? '' : `, parallel ${line.parallel}`;
  return (
    `${line.account}${describeDimensions(line.dims)} ${line.currency}: ` +
    `amount ${line.amount}, book ${line.book}${parallel}`
  );
}

/** Two lines are the same line when every field is equal; the dimensions in any order. */
function lineKey(line: PostedLine): string {
  const dims = Object.entries(line.dims).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const amounts = [line.amount, line.book, line.parallel].map((amount) => amount?.toString());
  return JSON.stringify([line.account, dims, line.currency, ...amounts]);
}

function compareLines(
  label: string,
  expected: readonly PostedLine[],
  posted: readonly PostedLine[],
) {
  const unmatched = new Map<string, PostedLine[]>();
  for (const line of posted) {
    const key = lineKey(line);
    unmatched.set(key, [...(unmatched.get(key) ?? []), line]);
  }
  const differences: string[] = [];
  for (const line of expected) {
    const same = unmatched.get(lineKey(line));
    if (same && same.length > 0) same.pop();
    else differences.push(`${label}: missing line ${describeLine(line)}`);
  }
  for (const lines of unmatched.values()) {
    for (const line of lines) differences.push(`${label}: extra line ${describeLine(line)}`);
  }
  return differences;
}

/**
 * The exact set (ADR 0008): the entries in posting order, each with its source and date, and its
 * lines as a multiset, every amount in both ledgers; no entry or line missing or extra. Every
 * posting wrote exactly one audit row.
 */
export function compareEntries(
  expected: readonly ExpectedEntry[],
  posted: readonly PostedEntry[],
): string[] {
  const differences: string[] = [];
  for (let index = 0; index < Math.max(expected.length, posted.length); index++) {
    const want = expected[index];
    const got = posted[index];
    const label = `entry ${index + 1}`;
    if (want && got) {
      const name = `${label} (${want.source}, ${want.date})`;
      if (got.source !== want.source) {
        differences.push(`${label}: source ${got.source}, expected ${want.source}`);
      }
      if (got.date !== want.date) {
        differences.push(`${label}: date ${got.date}, expected ${want.date}`);
      }
      differences.push(...compareLines(name, want.lines, got.lines));
    } else if (want) {
      differences.push(`${label} (${want.source}, ${want.date}): not posted`);
    } else if (got) {
      const lines = got.lines.map(describeLine).join('; ');
      differences.push(`${label} (${got.source}, ${got.date}): posted, not expected: ${lines}`);
    }
  }
  for (const [index, entry] of posted.entries()) {
    if (entry.auditRows !== 1) {
      differences.push(
        `entry ${index + 1} (${entry.source}, ${entry.date}): ${entry.auditRows} audit rows, expected one`,
      );
    }
  }
  return differences;
}

export function balanceQuery(balance: ExpectedBalance): BalanceQuery {
  return { account: balance.account, dims: balance.dims, currency: balance.currency };
}

/** A stated balance: the book and parallel amounts, and the transaction amount when stated. */
export function compareBalance(expected: ExpectedBalance, observed: ObservedBalance): string[] {
  const currency = expected.currency === null ? '' : ` ${expected.currency}`;
  const label = `balance of ${expected.account}${describeDimensions(expected.dims)}${currency}`;
  const differences: string[] = [];
  const pairs = [
    ['amount', expected.amount, observed.amount],
    ['book', expected.book, observed.book],
    ['parallel', expected.parallel, observed.parallel],
  ] as const;
  for (const [field, want, got] of pairs) {
    if (field === 'amount' && want === null) continue;
    if (want !== got)
      differences.push(`${label}: ${field} ${got ?? 'none'}, expected ${want ?? 'none'}`);
  }
  return differences;
}
