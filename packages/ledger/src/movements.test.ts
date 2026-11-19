import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocateOldestFirst, movementSides, openTotal } from './movements.js';

describe('movementSides', () => {
  it('gives the debit and the credit of an amount', () => {
    expect(movementSides(150_000n)).toEqual({ debit: 150_000n, credit: -150_000n });
  });

  it('refuses an amount of zero or below', () => {
    expect(() => movementSides(0n)).toThrow(RangeError);
    expect(() => movementSides(-1n)).toThrow(RangeError);
  });
});

describe('allocateOldestFirst', () => {
  // projects/simple-movements: M-1 whole, then 31,500.00 SYP of M-2.
  it('settles the oldest whole and the next in part', () => {
    const items = [
      { id: 'M-1', openMinor: 11_850_000n },
      { id: 'M-2', openMinor: 6_000_000n },
    ];
    expect(allocateOldestFirst(15_000_000n, items)).toEqual([
      { id: 'M-1', partMinor: 11_850_000n },
      { id: 'M-2', partMinor: 3_150_000n },
    ]);
    expect(openTotal(items)).toBe(17_850_000n);
  });

  it('stops at the item the amount ends on', () => {
    expect(
      allocateOldestFirst(500n, [
        { id: 'a', openMinor: 500n },
        { id: 'b', openMinor: 700n },
      ]),
    ).toEqual([{ id: 'a', partMinor: 500n }]);
  });

  it('refuses more than is open', () => {
    expect(() => allocateOldestFirst(2n, [{ id: 'a', openMinor: 1n }])).toThrow(RangeError);
  });

  it('allocates exactly the amount, in order, each part within its item', () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 1n, max: 10n ** 12n }), { minLength: 1, maxLength: 8 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (opens, share) => {
          const items = opens.map((openMinor, index) => ({ id: String(index), openMinor }));
          const total = openTotal(items);
          const amount = BigInt(Math.floor(Number(total) * share)) || 1n;
          const parts = allocateOldestFirst(amount, items);
          expect(parts.reduce((sum, part) => sum + part.partMinor, 0n)).toBe(amount);
          for (const [index, part] of parts.entries()) {
            const item = items[index];
            expect(part.id).toBe(item?.id);
            expect(part.partMinor > 0n && part.partMinor <= (item?.openMinor ?? 0n)).toBe(true);
            // Every item before the last is settled whole.
            if (index < parts.length - 1) expect(part.partMinor).toBe(item?.openMinor);
          }
        },
      ),
    );
  });
});
