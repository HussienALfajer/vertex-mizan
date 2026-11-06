import { AGEING_BUCKETS, CURRENCY_CODES, type CurrencyCode } from '@vertex-mizan/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type AgeingInput, ageingOf, dueDateInForce } from './ageing.js';
import { daysBetween } from './periods.js';

const C1 = 'client-c1';
const C2 = 'client-c2';

/** M-1 of `receivables/manual-settlement`: 1,000.00 USD opened 2026-11-03 at 120, due 2026-12-03. */
const m1: AgeingInput = {
  itemId: 'item-m1',
  clientId: C1,
  currency: 'USD',
  documentDate: '2026-11-03',
  dueDates: [
    { dueOn: '2026-12-03', effectiveOn: '2026-11-03', recordedAt: '2026-11-03T09:00:00Z' },
  ],
  openMinor: 100_000n,
  carryingMinor: 12_000_000n,
};

describe('daysBetween', () => {
  it('counts calendar days, a leap day included (S04 edge case 19)', () => {
    expect(daysBetween('2026-12-03', '2026-12-10')).toBe(7);
    expect(daysBetween('2026-12-10', '2026-12-03')).toBe(-7);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2000-02-28', '2000-03-01')).toBe(2);
    expect(daysBetween('2100-02-28', '2100-03-01')).toBe(1);
  });

  it('adds up across any three dates (property)', () => {
    const date = fc
      .date({
        min: new Date('1990-01-01T00:00:00Z'),
        max: new Date('2100-12-31T00:00:00Z'),
        noInvalidDate: true,
      })
      .map((value) => value.toISOString().slice(0, 10));
    fc.assert(
      fc.property(date, date, date, (a, b, c) => {
        expect(daysBetween(a, b) + daysBetween(b, c)).toBe(daysBetween(a, c));
        expect(daysBetween(a, b)).toBe(
          Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000),
        );
      }),
    );
  });
});

describe('dueDateInForce (S04 rule 14)', () => {
  const rows = [
    { dueOn: '2026-12-03', effectiveOn: '2026-11-03', recordedAt: '2026-11-03T09:00:00Z' },
    { dueOn: '2027-01-15', effectiveOn: '2026-12-20', recordedAt: '2026-12-20T10:00:00Z' },
    { dueOn: '2027-01-31', effectiveOn: '2026-12-20', recordedAt: '2026-12-20T11:00:00Z' },
  ];

  it('is the newest row effective on or before the date, the last recorded of a day', () => {
    expect(dueDateInForce(rows, '2026-11-03', '2026-12-19')).toBe('2026-12-03');
    expect(dueDateInForce(rows, '2026-11-03', '2026-12-20')).toBe('2027-01-31');
    expect(dueDateInForce([...rows].reverse(), '2026-11-03', '2027-06-01')).toBe('2027-01-31');
  });

  it('is the document date with no row in force', () => {
    expect(dueDateInForce([], '2026-11-03', '2026-11-30')).toBe('2026-11-03');
    expect(dueDateInForce(rows, '2026-11-01', '2026-11-02')).toBe('2026-11-01');
  });
});

describe('ageingOf (S04 rule 16)', () => {
  it('ages M-1 as the acceptance check reads it', () => {
    const onDue = ageingOf([m1], '2026-12-03');
    expect(onDue.clients).toEqual([
      {
        clientId: C1,
        buckets: { ...zeros(), not_due: 12_000_000n },
        totalMinor: 12_000_000n,
        items: [
          {
            itemId: 'item-m1',
            dueOn: '2026-12-03',
            daysPastDue: 0,
            bucket: 'not_due',
            openMinor: 100_000n,
            carryingMinor: 12_000_000n,
          },
        ],
      },
    ]);
    const week = ageingOf([m1], '2026-12-10');
    expect(week.clients[0]?.items[0]).toMatchObject({ daysPastDue: 7, bucket: 'days_1_30' });
    expect(week.buckets).toEqual({ ...zeros(), days_1_30: 12_000_000n });
    expect(week.currencies).toEqual([
      { currency: 'USD', buckets: { ...zeros(), days_1_30: 100_000n }, totalMinor: 100_000n },
    ]);
  });

  it('leaves out an item at zero, and ages one with no due date from its document date', () => {
    const settled = { ...m1, itemId: 'item-settled', openMinor: 0n, carryingMinor: 0n };
    const undated: AgeingInput = {
      ...m1,
      itemId: 'item-m2',
      clientId: C2,
      currency: 'SYP',
      dueDates: [],
      openMinor: 5_000_000n,
      carryingMinor: 5_000_000n,
    };
    const ageing = ageingOf([settled, undated], '2027-06-01');
    expect(ageing.clients.map((client) => client.clientId)).toEqual([C2]);
    expect(ageing.clients[0]?.items[0]).toMatchObject({
      dueOn: '2026-11-03',
      daysPastDue: 210,
      bucket: 'over_180',
    });
    expect(ageing.totalMinor).toBe(5_000_000n);
  });

  it('lists a client’s items oldest first, and totals buckets in the ledger currency', () => {
    const later: AgeingInput = {
      ...m1,
      itemId: 'item-m3',
      documentDate: '2026-11-20',
      dueDates: [],
      openMinor: 20_000n,
      carryingMinor: 2_460_000n,
    };
    const ageing = ageingOf([later, m1], '2027-01-10');
    expect(ageing.clients[0]?.items.map((item) => [item.itemId, item.bucket])).toEqual([
      ['item-m3', 'days_31_60'],
      ['item-m1', 'days_31_60'],
    ]);
    expect(ageing.clients[0]?.buckets.days_31_60).toBe(14_460_000n);
    expect(ageing.currencies[0]?.totalMinor).toBe(120_000n);
  });

  const input = fc.record({
    itemId: fc.uuid(),
    clientId: fc.option(fc.constantFrom('a', 'b', 'c'), { nil: null }),
    currency: fc.constantFrom<CurrencyCode>(...CURRENCY_CODES),
    documentDate: fc.constantFrom('2026-01-31', '2026-06-15', '2026-11-03'),
    dueDates: fc.array(
      fc.record({
        dueOn: fc.constantFrom('2026-02-01', '2026-07-30', '2026-12-31', '2027-03-01'),
        effectiveOn: fc.constantFrom('2026-01-31', '2026-08-01', '2026-12-01'),
        recordedAt: fc.constantFrom('2026-01-01T00:00:00Z', '2026-12-01T00:00:00Z'),
      }),
      { maxLength: 3 },
    ),
    openMinor: fc.bigInt({ min: -1_000_000n, max: 1_000_000n }),
    carryingMinor: fc.bigInt({ min: -100_000_000n, max: 100_000_000n }),
  });

  it('places every open item once, and its totals add up in every way (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(input, { selector: (item) => item.itemId, maxLength: 30 }),
        fc.constantFrom('2026-01-31', '2026-07-01', '2026-12-31', '2028-02-29'),
        (items, on) => {
          const ageing = ageingOf(items, on);
          const open = items.filter((item) => item.openMinor !== 0n);
          const aged = ageing.clients.flatMap((client) => client.items);
          expect(aged.map((item) => item.itemId).sort()).toEqual(
            open.map((item) => item.itemId).sort(),
          );
          const sum = (values: readonly bigint[]) => values.reduce((a, b) => a + b, 0n);
          expect(ageing.totalMinor).toBe(sum(open.map((item) => item.carryingMinor)));
          expect(ageing.totalMinor).toBe(sum(ageing.clients.map((client) => client.totalMinor)));
          for (const bucket of AGEING_BUCKETS) {
            expect(ageing.buckets[bucket]).toBe(
              sum(ageing.clients.map((client) => client.buckets[bucket])),
            );
          }
          for (const { currency, totalMinor } of ageing.currencies) {
            expect(totalMinor).toBe(
              sum(open.filter((item) => item.currency === currency).map((item) => item.openMinor)),
            );
          }
          for (const item of aged) {
            expect(item.daysPastDue).toBe(daysBetween(item.dueOn, on));
          }
        },
      ),
    );
  });
});

function zeros() {
  return Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, 0n]));
}
