import {
  AGEING_BUCKETS,
  type AgeingBucket,
  ageingBucketOf,
  type CurrencyCode,
} from '@vertex-mizan/contracts';
import { daysBetween } from './periods.js';

/**
 * The receivables ageing (S04 rules 14 and 16): each open document item's due date in force on a
 * date, its days past due and its bucket, and the totals per client, per bucket and per transaction
 * currency. The API reads the items' amounts at the date (their movements dated on or before it)
 * and their due-date history; nothing here reads a rate.
 */

/** A row of an item's due-date history (`open_item_due_dates`). */
export interface DueDateRow {
  readonly dueOn: string;
  /** From when it applies. */
  readonly effectiveOn: string;
  /** When it was recorded, as an ISO timestamp: of two rows effective on one date, the later wins. */
  readonly recordedAt: string;
}

/**
 * A document item's due date in force on `on` (rule 14): the newest row effective on or before it,
 * the one recorded last among rows of one date; with none, its document date.
 */
export function dueDateInForce(
  rows: readonly DueDateRow[],
  documentDate: string,
  on: string,
): string {
  let best: DueDateRow | null = null;
  for (const row of rows) {
    if (row.effectiveOn > on) continue;
    if (
      best === null ||
      row.effectiveOn > best.effectiveOn ||
      (row.effectiveOn === best.effectiveOn && row.recordedAt > best.recordedAt)
    ) {
      best = row;
    }
  }
  return best?.dueOn ?? documentDate;
}

/** An item as the ageing reads it at the date. */
export interface AgeingInput {
  readonly itemId: string;
  /** The client's dimension value; null for an item with no client. */
  readonly clientId: string | null;
  readonly currency: CurrencyCode;
  readonly documentDate: string;
  readonly dueDates: readonly DueDateRow[];
  /** The open amount at the end of the date, in the item's currency. */
  readonly openMinor: bigint;
  /** The carrying amount at the end of the date, in the selected ledger's currency. */
  readonly carryingMinor: bigint;
}

export interface AgedItem {
  readonly itemId: string;
  readonly dueOn: string;
  readonly daysPastDue: number;
  readonly bucket: AgeingBucket;
  readonly openMinor: bigint;
  readonly carryingMinor: bigint;
}

export type BucketTotals = Readonly<Record<AgeingBucket, bigint>>;

export interface AgedClient {
  readonly clientId: string | null;
  readonly buckets: BucketTotals;
  readonly totalMinor: bigint;
  /** By days past due, the oldest first, then by item id. */
  readonly items: readonly AgedItem[];
}

export interface AgedCurrency {
  readonly currency: CurrencyCode;
  readonly buckets: BucketTotals;
  readonly totalMinor: bigint;
}

export interface Ageing {
  /** In the order of the clients' first items as given (the API sorts them by name). */
  readonly clients: readonly AgedClient[];
  /** In the selected ledger's currency. */
  readonly buckets: BucketTotals;
  readonly totalMinor: bigint;
  /** In each transaction currency, by currency code. */
  readonly currencies: readonly AgedCurrency[];
}

const noBuckets = (): Record<AgeingBucket, bigint> =>
  Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, 0n])) as Record<AgeingBucket, bigint>;

/**
 * The ageing as of `on` (rule 16): every item whose open amount at the date is not zero, aged by
 * its due date in force on that date (days past due: `on` minus the due date); a client's buckets
 * and total, the buckets and total of all clients in the ledger's currency, and those of each
 * transaction currency in that currency. Items at zero are left out.
 */
export function ageingOf(items: readonly AgeingInput[], on: string): Ageing {
  const clients = new Map<
    string,
    { clientId: string | null; buckets: Record<AgeingBucket, bigint>; items: AgedItem[] }
  >();
  const buckets = noBuckets();
  const currencies = new Map<CurrencyCode, Record<AgeingBucket, bigint>>();
  for (const item of items) {
    if (item.openMinor === 0n) continue;
    const dueOn = dueDateInForce(item.dueDates, item.documentDate, on);
    const daysPastDue = daysBetween(dueOn, on);
    const bucket = ageingBucketOf(daysPastDue);
    const key = item.clientId ?? '';
    const client = clients.get(key) ?? {
      clientId: item.clientId,
      buckets: noBuckets(),
      items: [],
    };
    clients.set(key, client);
    client.items.push({
      itemId: item.itemId,
      dueOn,
      daysPastDue,
      bucket,
      openMinor: item.openMinor,
      carryingMinor: item.carryingMinor,
    });
    client.buckets[bucket] += item.carryingMinor;
    buckets[bucket] += item.carryingMinor;
    const byCurrency = currencies.get(item.currency) ?? noBuckets();
    currencies.set(item.currency, byCurrency);
    byCurrency[bucket] += item.openMinor;
  }
  const total = (totals: BucketTotals) =>
    AGEING_BUCKETS.reduce((sum, bucket) => sum + totals[bucket], 0n);
  return {
    clients: [...clients.values()].map((client) => ({
      clientId: client.clientId,
      buckets: client.buckets,
      totalMinor: total(client.buckets),
      items: client.items.sort(
        (a, b) =>
          b.daysPastDue - a.daysPastDue || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0),
      ),
    })),
    buckets,
    totalMinor: total(buckets),
    currencies: [...currencies.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([currency, totals]) => ({ currency, buckets: totals, totalMinor: total(totals) })),
  };
}
