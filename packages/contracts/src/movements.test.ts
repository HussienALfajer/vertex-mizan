import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createProjectSchema,
  dashboardSchema,
  movementSchema,
  recordMovementSchema,
} from './movements.js';

const base = {
  requestKey: 'key-1',
  date: '2026-12-02',
  currency: 'USD',
  description: 'حركة تجريبية',
};
const project = '01900000-0000-7000-8000-000000000001';
const supplier = '01900000-0000-7000-8000-000000000002';
const material = '01900000-0000-7000-8000-000000000003';

describe('recordMovementSchema', () => {
  it('takes each kind with its fields', () => {
    expect(
      recordMovementSchema.parse({
        ...base,
        kind: 'received',
        projectId: project,
        amountMinor: '500000',
      }),
    ).toMatchObject({ supplierId: null, material: null, dealtRate: null });
    expect(
      recordMovementSchema.safeParse({
        ...base,
        kind: 'owed_by_us',
        projectId: project,
        supplierId: supplier,
        material: { materialId: material, quantity: '10.000', unitPrice: '815.0000' },
      }).success,
    ).toBe(true);
    expect(
      recordMovementSchema.safeParse({ ...base, kind: 'deposit', amountMinor: '400000' }).success,
    ).toBe(true);
  });

  it('refuses the fields a kind does not take', () => {
    const refused = (input: object) =>
      recordMovementSchema.safeParse({ ...base, ...input }).success;
    // a deposit is on no project; every other kind is on one
    expect(refused({ kind: 'deposit', projectId: project, amountMinor: '1' })).toBe(false);
    expect(refused({ kind: 'wages', amountMinor: '1' })).toBe(false);
    // a supplier only on owed by us and debt paid
    expect(
      refused({ kind: 'received', projectId: project, supplierId: supplier, amountMinor: '1' }),
    ).toBe(false);
    expect(refused({ kind: 'debt_paid', projectId: project, amountMinor: '1' })).toBe(false);
    // a material only on an expense or owed by us, and never with an amount
    expect(
      refused({
        kind: 'wages',
        projectId: project,
        material: { materialId: material, quantity: '1.000', unitPrice: '1.0000' },
      }),
    ).toBe(false);
    expect(
      refused({
        kind: 'expense',
        projectId: project,
        amountMinor: '1',
        material: { materialId: material, quantity: '1.000', unitPrice: '1.0000' },
      }),
    ).toBe(false);
    // an amount above zero
    expect(refused({ kind: 'wages', projectId: project, amountMinor: '0' })).toBe(false);
    expect(refused({ kind: 'wages', projectId: project, amountMinor: '-5' })).toBe(false);
  });
});

describe('createProjectSchema', () => {
  it('takes an existing client or a new one, not both', () => {
    const input = { name: 'مشروع', startDate: '2026-12-01' };
    expect(createProjectSchema.safeParse({ ...input, clientName: 'عميل' }).success).toBe(true);
    expect(createProjectSchema.safeParse({ ...input, clientId: project }).success).toBe(true);
    expect(createProjectSchema.safeParse(input).success).toBe(false);
    expect(
      createProjectSchema.safeParse({ ...input, clientId: project, clientName: 'عميل' }).success,
    ).toBe(false);
  });
});

describe('the answers', () => {
  it('convert to JSON Schema with their ids', () => {
    for (const schema of [movementSchema, dashboardSchema, recordMovementSchema]) {
      expect(() => z.toJSONSchema(schema, { io: 'input' })).not.toThrow();
    }
  });
});
