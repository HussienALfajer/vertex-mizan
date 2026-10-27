import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ACCOUNT_CLASSES,
  ACCOUNT_ROLES,
  type AccountShape,
  accountClassOfCode,
  accountCodeLevel,
  accountRoleFits,
  checkAccountCode,
  checkAccountShape,
  createAccountSchema,
  defaultNormalBalance,
  parentAccountCode,
  ROOT_ACCOUNTS,
  STATEMENT_LINES,
  statementLineFits,
  updateAccountSchema,
} from './chart.js';
import { DomainError, type ErrorCode } from './errors.js';

function codeOf(work: () => unknown): ErrorCode | 'none' {
  try {
    work();
    return 'none';
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
}

describe('the account code shape (ADR 0011)', () => {
  it('gives each level its shape', () => {
    expect(accountCodeLevel('1')).toBe(1);
    expect(accountCodeLevel('11')).toBe(2);
    expect(accountCodeLevel('111')).toBe(3);
    expect(accountCodeLevel('111001')).toBe(4);
    expect(accountCodeLevel('111999')).toBe(4);
  });

  it('refuses codes that fit no level', () => {
    for (const code of ['', '0', '6', '9', '10', '101', '1110', '11100', '111000', '1110071']) {
      expect(accountCodeLevel(code)).toBeNull();
    }
  });

  it('takes the class from the first digit', () => {
    expect(['1', '2', '3', '4', '5'].map(accountClassOfCode)).toEqual(ACCOUNT_CLASSES);
    expect(accountClassOfCode('541003')).toBe('expense');
    expect(() => accountClassOfCode('6')).toThrow(RangeError);
  });

  it('names the parent each level needs', () => {
    expect(parentAccountCode('1')).toBeNull();
    expect(parentAccountCode('11')).toBe('1');
    expect(parentAccountCode('111')).toBe('11');
    expect(parentAccountCode('111007')).toBe('111');
  });

  it('accepts a code that extends a header parent, and refuses the rest', () => {
    const header = { code: '111', level: 3, kind: 'header' } as const;
    expect(checkAccountCode('111007', header)).toBe(4);
    expect(codeOf(() => checkAccountCode('1110071', header))).toBe('ACCOUNT_CODE_INVALID');
    expect(codeOf(() => checkAccountCode('112001', header))).toBe('ACCOUNT_CODE_INVALID');
    expect(codeOf(() => checkAccountCode('111000', header))).toBe('ACCOUNT_CODE_INVALID');
    expect(codeOf(() => checkAccountCode('1', header))).toBe('ACCOUNT_CODE_INVALID');
    const postable = { code: '114', level: 3, kind: 'postable' } as const;
    expect(codeOf(() => checkAccountCode('114001', postable))).toBe('ACCOUNT_NOT_HEADER');
  });

  it('places every well-shaped code under exactly its parent', () => {
    const code = fc.oneof(
      fc
        .tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 9 }))
        .map(([a, b]) => `${a}${b}`),
      fc
        .tuple(
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 1, max: 9 }),
          fc.integer({ min: 1, max: 9 }),
        )
        .map(([a, b, c]) => `${a}${b}${c}`),
      fc
        .tuple(
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 1, max: 9 }),
          fc.integer({ min: 1, max: 9 }),
          fc.integer({ min: 1, max: 999 }),
        )
        .map(([a, b, c, d]) => `${a}${b}${c}${String(d).padStart(3, '0')}`),
    );
    fc.assert(
      fc.property(code, (child) => {
        const parentCode = parentAccountCode(child);
        expect(parentCode).not.toBeNull();
        const parent = {
          code: parentCode as string,
          level: accountCodeLevel(parentCode as string) as 1 | 2 | 3,
          kind: 'header' as const,
        };
        expect(checkAccountCode(child, parent)).toBe(parent.level + 1);
        expect(accountClassOfCode(child)).toBe(accountClassOfCode(parent.code));
      }),
    );
  });

  it('defaults the normal balance by class', () => {
    expect(ACCOUNT_CLASSES.map(defaultNormalBalance)).toEqual([
      'debit',
      'credit',
      'credit',
      'credit',
      'debit',
    ]);
  });

  it('has the five roots, one per class', () => {
    expect(ROOT_ACCOUNTS.map((root) => [root.code, root.class])).toEqual(
      ACCOUNT_CLASSES.map((accountClass, index) => [String(index + 1), accountClass]),
    );
  });
});

describe('the statement-line catalogue', () => {
  it('has unique codes, each with its statement prefix and an IFRS 18 category on the income statement only', () => {
    expect(new Set(STATEMENT_LINES.map((line) => line.code)).size).toBe(STATEMENT_LINES.length);
    for (const line of STATEMENT_LINES) {
      expect(line.code.startsWith(line.statement === 'balance_sheet' ? 'bs.' : 'is.')).toBe(true);
      expect(line.ifrs18Category === null).toBe(line.statement === 'balance_sheet');
      expect(line.name.length).toBeGreaterThan(0);
      expect(line.nameLatin.length).toBeGreaterThan(0);
      expect(line.basis.length).toBeGreaterThan(0);
    }
  });

  it('fits balance-sheet lines to classes 1–3 and income-statement lines to 4–5', () => {
    expect(statementLineFits('bs.cash', 'asset')).toBe(true);
    expect(statementLineFits('bs.cash', 'revenue')).toBe(false);
    expect(statementLineFits('is.revenue', 'revenue')).toBe(true);
    expect(statementLineFits('is.revenue', 'equity')).toBe(false);
    expect(statementLineFits('bs.unknown', 'asset')).toBe(false);
  });
});

describe('checkAccountShape (S02 checks 2–4)', () => {
  const postable: AccountShape = {
    level: 4,
    kind: 'postable',
    class: 'asset',
    statementLine: 'bs.cash',
    currency: 'USD',
    isControl: false,
    isMonetary: true,
    requiredDimensionCount: 0,
  };
  const header: AccountShape = {
    ...postable,
    level: 3,
    kind: 'header',
    statementLine: null,
    currency: null,
    isMonetary: false,
  };

  it('accepts a postable account and a bare header', () => {
    expect(codeOf(() => checkAccountShape(postable))).toBe('none');
    expect(codeOf(() => checkAccountShape(header))).toBe('none');
  });

  it('refuses a postable account at levels 1 and 2', () => {
    expect(codeOf(() => checkAccountShape({ ...postable, level: 2 }))).toBe('VALIDATION_FAILED');
  });

  it('needs a fitting statement line on a postable account, and none on a header', () => {
    expect(codeOf(() => checkAccountShape({ ...postable, statementLine: null }))).toBe(
      'STATEMENT_LINE_INVALID',
    );
    expect(codeOf(() => checkAccountShape({ ...postable, statementLine: 'is.revenue' }))).toBe(
      'STATEMENT_LINE_INVALID',
    );
    expect(codeOf(() => checkAccountShape({ ...header, statementLine: 'bs.cash' }))).toBe(
      'STATEMENT_LINE_INVALID',
    );
  });

  it('keeps flags, currencies and required dimensions off headers', () => {
    for (const change of [
      { currency: 'USD' },
      { isControl: true },
      { isMonetary: true },
      { requiredDimensionCount: 1 },
    ] as const) {
      expect(codeOf(() => checkAccountShape({ ...header, ...change }))).toBe('VALIDATION_FAILED');
    }
  });

  it('lets only assets and liabilities be monetary or control accounts', () => {
    const revenue: AccountShape = {
      ...postable,
      class: 'revenue',
      statementLine: 'is.revenue',
      currency: null,
    };
    expect(codeOf(() => checkAccountShape({ ...revenue, isMonetary: true }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(codeOf(() => checkAccountShape({ ...revenue, isMonetary: false }))).toBe('none');
    expect(
      codeOf(() =>
        checkAccountShape({
          ...postable,
          class: 'liability',
          statementLine: 'bs.client_money',
          isControl: true,
        }),
      ),
    ).toBe('none');
  });
});

describe('accountRoleFits (S02 rule 7)', () => {
  it('gives each role its classes, on postable accounts only', () => {
    const fits = Object.fromEntries(
      ACCOUNT_ROLES.map((role) => [
        role,
        ACCOUNT_CLASSES.filter((accountClass) =>
          accountRoleFits(role, { kind: 'postable', class: accountClass }),
        ),
      ]),
    );
    expect(fits).toEqual({
      conversion_rounding: ['revenue', 'expense'],
      fx_realised_gain: ['revenue'],
      fx_realised_loss: ['expense'],
      fx_unrealised_gain: ['revenue'],
      fx_unrealised_loss: ['expense'],
      retained_earnings: ['equity'],
    });
    for (const role of ACCOUNT_ROLES) {
      for (const accountClass of ACCOUNT_CLASSES) {
        expect(accountRoleFits(role, { kind: 'header', class: accountClass })).toBe(false);
      }
    }
  });
});

describe('the account schemas', () => {
  const parentId = '01900000-0000-7000-8000-000000000001';

  it('default a new account to no flags, no currency and no required dimension', () => {
    expect(
      createAccountSchema.parse({ parentId, code: '111007', kind: 'postable', name: ' حساب ' }),
    ).toEqual({
      parentId,
      code: '111007',
      kind: 'postable',
      name: 'حساب',
      nameLatin: null,
      statementLine: null,
      currency: null,
      isControl: false,
      isMonetary: false,
      requiredDimensionTypeIds: [],
    });
  });

  it('refuse codes that are not digits, and a dimension type twice', () => {
    expect(
      createAccountSchema.safeParse({ parentId, code: '11a', kind: 'header', name: 'x' }).success,
    ).toBe(false);
    expect(
      createAccountSchema.safeParse({
        parentId,
        code: '111007',
        kind: 'postable',
        name: 'x',
        requiredDimensionTypeIds: [parentId, parentId],
      }).success,
    ).toBe(false);
  });

  it('refuse an empty change', () => {
    expect(updateAccountSchema.safeParse({}).success).toBe(false);
    expect(updateAccountSchema.safeParse({ name: 'اسم' }).success).toBe(true);
  });

  it('convert to JSON Schema with their ids', () => {
    const { schemas } = z.toJSONSchema(z.globalRegistry, {
      target: 'draft-2020-12',
      unrepresentable: 'throw',
    });
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'Account',
        'AccountQuery',
        'CreateAccount',
        'UpdateAccount',
        'SetAccountRole',
        'AccountRoleAssignment',
        'ChartTemplateSummary',
        'ApplyChartTemplate',
        'ChartExportQuery',
        'StatementLine',
      ]),
    );
  });
});
