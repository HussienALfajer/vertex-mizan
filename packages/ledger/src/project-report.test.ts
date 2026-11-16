import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  averageUnitCost,
  billingNet,
  decimalShare,
  onItsSide,
  percentOf,
  projectCosts,
  quantityText,
  showsVariance,
} from './project-report.js';

describe('the project report (S12 "Reports", reports/project-report.md)', () => {
  it("rounds the scenario's percentages half away from zero", () => {
    // Billed: 30,000.00 of 100,000.00.
    expect(percentOf(3_000_000n, 10_000_000n)).toBe('30.0');
    // Used: 3,008.09 of 40,000.00 = 7.52% → 7.5; 550.00 of 15,000.00 = 3.666…% → 3.7.
    expect(percentOf(300_809n, 4_000_000n)).toBe('7.5');
    expect(percentOf(55_000n, 1_500_000n)).toBe('3.7');
    expect(percentOf(-45_000n, 4_545_000n)).toBe('-1.0');
    expect(percentOf(1n, 0n)).toBeNull();
    expect(decimalShare(5n, 2n, 0)).toBe('3');
    expect(decimalShare(-5n, 2n, 0)).toBe('-3');
  });

  it('writes quantities with 3 places and averages with 4', () => {
    expect(quantityText(12_500n)).toBe('12.500');
    expect(quantityText(-5_000n)).toBe('-5.000');
    expect(quantityText(0n)).toBe('0.000');
    expect(quantityText(7n)).toBe('0.007');
    // 39,375.00 TRY over 12.500 t; 450.00 USD over 5.000 t; −450.00 over −5.000.
    expect(averageUnitCost(3_937_500n, 'TRY', 12_500n)).toBe('3150.0000');
    expect(averageUnitCost(45_000n, 'USD', 5_000n)).toBe('90.0000');
    expect(averageUnitCost(-45_000n, 'USD', -5_000n)).toBe('90.0000');
    expect(averageUnitCost(2_500n, 'USD', 0n)).toBeNull();
  });

  it('shows the variance only in the book ledger in the book currency (S12 answer 15)', () => {
    expect(showsVariance({ termsCurrency: 'USD', bookCurrency: 'USD', ledger: 'book' })).toBe(true);
    expect(showsVariance({ termsCurrency: 'USD', bookCurrency: 'USD', ledger: 'parallel' })).toBe(
      false,
    );
    expect(showsVariance({ termsCurrency: 'USD', bookCurrency: 'SYP', ledger: 'book' })).toBe(
      false,
    );
    expect(showsVariance({ termsCurrency: null, bookCurrency: 'SYP', ledger: 'book' })).toBe(false);
  });

  it("gives the December case's costs against the budget", () => {
    const costs = projectCosts(
      [
        { inRange: 300_809n, toDate: 300_809n, budget: 4_000_000n },
        { inRange: 55_000n, toDate: 55_000n, budget: 1_500_000n },
        { inRange: 1_200_000n, toDate: 1_200_000n, budget: 3_500_000n },
      ],
      true,
    );
    expect(costs.rows.map((row) => [row.variance, row.used])).toEqual([
      [3_699_191n, '7.5'],
      [1_445_000n, '3.7'],
      [2_300_000n, '34.3'],
    ]);
    expect(costs.totals).toEqual({
      inRange: 1_555_809n,
      toDate: 1_555_809n,
      budget: 9_000_000n,
      variance: 7_444_191n,
      used: '17.3',
    });
    const alone = projectCosts([{ inRange: 1n, toDate: 2n, budget: 3n }], false);
    expect(alone.totals.variance).toBeNull();
    expect(alone.rows[0]?.used).toBeNull();
  });

  it('sums the rows into the totals, and the variances into the total variance', () => {
    const row = fc.record({
      inRange: fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
      toDate: fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
      budget: fc.bigInt({ min: 0n, max: 10n ** 12n }),
    });
    fc.assert(
      fc.property(fc.array(row, { maxLength: 8 }), (rows) => {
        const costs = projectCosts(rows, true);
        const sum = (values: bigint[]) => values.reduce((a, b) => a + b, 0n);
        expect(costs.totals.inRange).toBe(sum(rows.map((r) => r.inRange)));
        expect(costs.totals.variance).toBe(sum(costs.rows.map((r) => r.variance ?? 0n)));
      }),
    );
  });

  it("nets a billing's deductions and shows a balance on its own side", () => {
    expect(
      billingNet({
        cumulative: 7_500_000n,
        previous: 3_000_000n,
        retention: 450_000n,
        advance: 1_000_000n,
      }),
    ).toEqual({ period: 4_500_000n, net: 3_050_000n });
    expect(onItsSide(-1_400_000n, 'credit')).toBe(1_400_000n);
    expect(onItsSide(300_000n, 'debit')).toBe(300_000n);
  });
});
