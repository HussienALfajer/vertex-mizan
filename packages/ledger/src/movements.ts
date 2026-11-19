/**
 * S13's project movements (ADR 0024): the signed amounts of a movement's two sides, and a
 * collection spread over a client's open items oldest due first (S13 rule 5). Pure: the caller
 * reads the items and posts the lines.
 */

/** A movement's amount as a debit line and as a credit line: positive and negative. */
export function movementSides(amountMinor: bigint): { debit: bigint; credit: bigint } {
  if (amountMinor <= 0n) throw new RangeError('A movement is above zero');
  return { debit: amountMinor, credit: -amountMinor };
}

/** An open item a collection may settle, in the order it is settled. */
export interface CollectableItem {
  readonly id: string;
  /** What remains open, in the item's currency, above zero. */
  readonly openMinor: bigint;
}

/**
 * A collection spread over the items in their order (S13 rule 5): each item settled whole while
 * the amount lasts, the last one it reaches in part. Each part is the amount to credit the item.
 * Throws when the amount is more than all that is open: the caller refuses it first.
 */
export function allocateOldestFirst(
  amountMinor: bigint,
  items: readonly CollectableItem[],
): { id: string; partMinor: bigint }[] {
  let left = amountMinor;
  const parts: { id: string; partMinor: bigint }[] = [];
  for (const item of items) {
    if (left === 0n) break;
    const partMinor = item.openMinor < left ? item.openMinor : left;
    parts.push({ id: item.id, partMinor });
    left -= partMinor;
  }
  if (left !== 0n) throw new RangeError('More than is open');
  return parts;
}

/** The sum of what is open on the items. */
export function openTotal(items: readonly CollectableItem[]): bigint {
  return items.reduce((sum, item) => sum + item.openMinor, 0n);
}
