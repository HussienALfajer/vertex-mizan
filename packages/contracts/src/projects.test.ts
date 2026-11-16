import { describe, expect, it } from 'vitest';
import { draftInputSchema, draftLineInputSchema } from './entries.js';
import {
  isZeroQuantity,
  lineAmount,
  quantityPlacesUsed,
  quantitySchema,
  unitPriceSchema,
} from './money.js';
import { projectDocumentHeaderInputSchema } from './project-documents.js';
import {
  createMaterialSchema,
  createSubcontractSchema,
  projectTermsInputSchema,
  updateMaterialSchema,
} from './projects.js';

const id = (n: number) => `019a2b3c-0000-7000-8000-${n.toString().padStart(12, '0')}`;

describe('lineAmount (S12 rule 6)', () => {
  it("is the rounded product, half away from zero, in the scenarios' numbers", () => {
    expect(lineAmount('12.500', '3150.0000', 'TRY').amountMinor).toBe(3937500n);
    expect(lineAmount('12.500', '3.0300', 'USD').amountMinor).toBe(3788n);
    expect(lineAmount('-2.500', '3.0300', 'USD').amountMinor).toBe(-758n);
    expect(lineAmount('1.500', '933.3300', 'TRY').amountMinor).toBe(140000n);
    expect(lineAmount('0.125', '0.0300', 'USD').amountMinor).toBe(0n);
    expect(lineAmount('6.000', '25.0000', 'USD')).toEqual({ amountMinor: 15000n, currency: 'USD' });
  });

  it('is the negation of the opposite quantity', () => {
    for (const [quantity, price] of [
      ['0.005', '1.0000'],
      ['7.333', '0.0015'],
      ['99999999999.999', '99999.9999'],
    ] as const) {
      expect(lineAmount(`-${quantity}`, price, 'SYP').amountMinor).toBe(
        -lineAmount(quantity, price, 'SYP').amountMinor,
      );
    }
  });

  it('refuses a product outside the stored range, and text that is not a decimal', () => {
    expect(() => lineAmount('99999999999.999', '99999999999999.9999', 'USD')).toThrow(
      'outside the stored range',
    );
    expect(() => lineAmount('1e3', '1.0000', 'USD')).toThrow(TypeError);
  });
});

describe('quantities and unit prices', () => {
  it('are written back with 3 and 4 places', () => {
    expect(quantitySchema.parse('6.0')).toBe('6.000');
    expect(quantitySchema.parse('-2.5')).toBe('-2.500');
    expect(quantitySchema.parse('-0')).toBe('0.000');
    expect(quantitySchema.parse('12')).toBe('12.000');
    expect(unitPriceSchema.parse('25')).toBe('25.0000');
    expect(unitPriceSchema.parse('0.03')).toBe('0.0300');
  });

  it('refuse more places, a negative unit price, and other text', () => {
    for (const text of ['1.0001', '1,5', '', '1e3', '١٢']) {
      expect(quantitySchema.safeParse(text).success, text).toBe(false);
    }
    for (const text of ['-1', '1.00001', 'abc']) {
      expect(unitPriceSchema.safeParse(text).success, text).toBe(false);
    }
  });

  it('tell a price adjustment and the places a quantity uses', () => {
    expect(isZeroQuantity('0.000')).toBe(true);
    expect(isZeroQuantity('0.001')).toBe(false);
    expect(quantityPlacesUsed('6.500')).toBe(1);
    expect(quantityPlacesUsed('6.000')).toBe(0);
    expect(quantityPlacesUsed('1.250')).toBe(2);
  });
});

describe('a draft line with a quantity', () => {
  const line = { accountId: id(1), currency: 'TRY', amountMinor: null };

  it('takes a material, its quantity and unit price', () => {
    const parsed = draftLineInputSchema.parse({
      ...line,
      materialId: id(2),
      quantity: '12.5',
      unitPrice: '3150',
    });
    expect(parsed).toMatchObject({ quantity: '12.500', unitPrice: '3150.0000', unit: null });
  });

  it('refuses a material, a unit or a price with no quantity, and a negative covered part', () => {
    expect(draftLineInputSchema.safeParse({ ...line, materialId: id(2) }).success).toBe(false);
    expect(draftLineInputSchema.safeParse({ ...line, unitPrice: '1' }).success).toBe(false);
    expect(
      draftLineInputSchema.safeParse({ ...line, quantity: '1', advanceMinor: '-1' }).success,
    ).toBe(false);
  });
});

describe('projectDocumentHeaderInputSchema', () => {
  const contractValueId = id(10);
  const sheet = {
    kind: 'wage_sheet',
    contractValueId,
    currency: 'USD',
    periodFrom: '2026-12-01',
    periodTo: '2026-12-15',
  };

  it('takes each kind with its own fields', () => {
    for (const header of [
      {
        kind: 'purchase',
        contractValueId,
        counterpartyValueId: id(11),
        currency: 'TRY',
        advanceMinor: '1500000',
        supplierReference: 'F-1024',
      },
      sheet,
      { kind: 'progress_billing', contractValueId, cumulativeMinor: '3000000' },
      {
        kind: 'subcontract_billing',
        contractValueId,
        counterpartyValueId: id(11),
        cumulativeMinor: '1',
      },
      {
        kind: 'retention_release',
        contractValueId,
        side: 'client',
        retentionItems: [{ itemId: id(12), amountMinor: '300000' }],
      },
      {
        kind: 'retention_release',
        contractValueId,
        side: 'supplier',
        counterpartyValueId: id(11),
        retentionMinor: '1',
      },
    ]) {
      expect(projectDocumentHeaderInputSchema.safeParse(header).success, header.kind).toBe(true);
    }
  });

  it('refuses fields another kind takes', () => {
    for (const header of [
      { kind: 'purchase', contractValueId, currency: 'TRY' },
      { kind: 'purchase', contractValueId, counterpartyValueId: id(11) },
      { ...sheet, periodTo: null },
      { ...sheet, periodFrom: '2026-12-16' },
      { ...sheet, supplierReference: 'x' },
      { ...sheet, advanceMinor: '1' },
      { kind: 'progress_billing', contractValueId, currency: 'USD' },
      { kind: 'progress_billing', contractValueId, counterpartyValueId: id(11) },
      { kind: 'retention_release', contractValueId },
      { kind: 'retention_release', contractValueId, side: 'supplier', retentionItems: [] },
    ]) {
      expect(
        projectDocumentHeaderInputSchema.safeParse(header).success,
        JSON.stringify(header),
      ).toBe(false);
    }
  });

  it('is never a voucher too', () => {
    const draft = {
      entryDate: '2026-12-03',
      projectDocument: { kind: 'progress_billing', contractValueId, cumulativeMinor: '1' },
    };
    expect(draftInputSchema.safeParse(draft).success).toBe(true);
    expect(
      draftInputSchema.safeParse({ ...draft, voucher: { kind: 'receipt', cashAccountId: id(13) } })
        .success,
    ).toBe(false);
  });
});

describe('master data', () => {
  it('reads a material, and refuses an empty change', () => {
    expect(
      createMaterialSchema.parse({ code: 'CEM', name: 'أسمنت بورتلاندي', unit: 'طن' }),
    ).toEqual({ code: 'CEM', name: 'أسمنت بورتلاندي', nameLatin: null, unit: 'طن' });
    expect(
      createMaterialSchema.safeParse({ code: 'x'.repeat(31), name: 'a', unit: 'b' }).success,
    ).toBe(false);
    expect(updateMaterialSchema.safeParse({}).success).toBe(false);
  });

  it('reads terms in basis points, each budget account once', () => {
    const terms = {
      currency: 'USD',
      contractValueMinor: '10000000',
      retentionBp: 1000,
      advanceRecoveryBp: 2000,
      budget: [{ accountId: id(1), amountMinor: '4000000' }],
    };
    expect(projectTermsInputSchema.safeParse(terms).success).toBe(true);
    expect(projectTermsInputSchema.safeParse({ ...terms, retentionBp: 10001 }).success).toBe(false);
    expect(projectTermsInputSchema.safeParse({ ...terms, contractValueMinor: '-1' }).success).toBe(
      false,
    );
    expect(
      projectTermsInputSchema.safeParse({ ...terms, budget: [...terms.budget, ...terms.budget] })
        .success,
    ).toBe(false);
    expect(
      createSubcontractSchema.parse({
        contractValueId: id(1),
        supplierValueId: id(2),
        currency: 'TRY',
        retentionBp: 500,
        advanceRecoveryBp: 0,
      }).valueMinor,
    ).toBeNull();
  });
});
