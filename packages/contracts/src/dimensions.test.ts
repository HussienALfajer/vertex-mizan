import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BUILTIN_DIMENSION_TYPES,
  createDimensionTypeSchema,
  createDimensionValueSchema,
  DIMENSION_TYPE_LIMIT,
  dimensionValueQuerySchema,
  linkDimensionValueSchema,
  updateDimensionTypeSchema,
  updateDimensionValueSchema,
} from './dimensions.js';

const typeId = '01900000-0000-7000-8000-000000000001';

describe('the built-in dimension types', () => {
  it('are client, contract under client, department and service (ADR 0011)', () => {
    expect(BUILTIN_DIMENSION_TYPES.map((type) => [type.code, type.parentCode])).toEqual([
      ['client', null],
      ['contract', 'client'],
      ['department', null],
      ['service', null],
    ]);
    for (const type of BUILTIN_DIMENSION_TYPES) {
      expect(
        createDimensionTypeSchema.safeParse({ code: type.code, name: type.name }).success,
      ).toBe(true);
    }
    expect(DIMENSION_TYPE_LIMIT).toBe(10);
  });
});

describe('the dimension schemas', () => {
  it('take type codes in lower snake case of 2–40 characters', () => {
    for (const code of ['cost_centre', 'ab', `a${'b'.repeat(39)}`]) {
      expect(createDimensionTypeSchema.safeParse({ code, name: 'نوع' }).success).toBe(true);
    }
    for (const code of ['a', 'Cost', '1abc', 'cost-centre', `a${'b'.repeat(40)}`]) {
      expect(createDimensionTypeSchema.safeParse({ code, name: 'نوع' }).success).toBe(false);
    }
  });

  it('default a manual value to no code, kind or parent, and trim its name', () => {
    expect(createDimensionValueSchema.parse({ typeId, name: ' عميل تجريبي ' })).toEqual({
      typeId,
      code: null,
      name: 'عميل تجريبي',
      nameLatin: null,
      contractKind: null,
      parentValueId: null,
    });
    expect(
      createDimensionValueSchema.safeParse({ typeId, name: 'عقد', contractKind: 'campaign' })
        .success,
    ).toBe(false);
  });

  it('refuse an empty change and an empty Hub ID', () => {
    expect(updateDimensionTypeSchema.safeParse({}).success).toBe(false);
    expect(updateDimensionValueSchema.safeParse({}).success).toBe(false);
    expect(updateDimensionValueSchema.safeParse({ code: null }).success).toBe(true);
    expect(linkDimensionValueSchema.safeParse({ externalId: '  ' }).success).toBe(false);
    expect(linkDimensionValueSchema.safeParse({ externalId: 'design' }).success).toBe(true);
  });

  it('need the type of the values listed', () => {
    expect(dimensionValueQuerySchema.safeParse({}).success).toBe(false);
    expect(dimensionValueQuerySchema.safeParse({ typeId, q: 'عم' }).success).toBe(true);
  });

  it('convert to JSON Schema with their ids', () => {
    const { schemas } = z.toJSONSchema(z.globalRegistry, {
      target: 'draft-2020-12',
      unrepresentable: 'throw',
    });
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'DimensionType',
        'CreateDimensionType',
        'UpdateDimensionType',
        'DimensionValue',
        'CreateDimensionValue',
        'UpdateDimensionValue',
        'LinkDimensionValue',
        'DimensionValueQuery',
        'DimensionValuePage',
      ]),
    );
  });
});
