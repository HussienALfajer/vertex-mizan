import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_ROLES,
  accountClassOfCode,
  accountCodeLevel,
  accountRoleFits,
  checkAccountShape,
  ROOT_ACCOUNTS,
} from './chart.js';
import { CHART_TEMPLATES, chartTemplate } from './chart-templates.js';

describe('the chart templates (S02 "Templates", drafts under Q3)', () => {
  for (const template of CHART_TEMPLATES) {
    describe(`${template.id}@${template.version}`, () => {
      const accounts = template.accounts;
      const byCode = new Map(accounts.map((account) => [account.code, account]));

      it('has unique, well-shaped codes in code order, each after its header parent', () => {
        expect(byCode.size).toBe(accounts.length);
        const codes = accounts.map((account) => account.code);
        expect(codes).toEqual([...codes].sort());
        for (const account of accounts) {
          const level = accountCodeLevel(account.code);
          expect(level, account.code).not.toBeNull();
          if (level === 1) continue;
          const parentCode = account.code.slice(0, level === 4 ? 3 : (level as number) - 1);
          expect(byCode.get(parentCode)?.kind, account.code).toBe('header');
        }
      });

      it('starts from the five roots with their names', () => {
        expect(
          accounts
            .filter((account) => accountCodeLevel(account.code) === 1)
            .map((account) => [account.code, account.name, account.nameLatin]),
        ).toEqual(ROOT_ACCOUNTS.map((root) => [root.code, root.name, root.nameLatin]));
      });

      it('fits S02 checks 2–4 on every account, postable ones being leaves', () => {
        for (const account of accounts) {
          const level = accountCodeLevel(account.code);
          if (level === null) throw new Error(account.code);
          checkAccountShape({
            level,
            kind: account.kind,
            class: accountClassOfCode(account.code),
            statementLine: account.statementLine,
            currency: account.currency,
            isControl: account.isControl,
            isMonetary: account.isMonetary,
            requiredDimensionCount: account.requiredDimensions.length,
          });
          if (account.kind === 'postable') {
            expect(
              accounts.some((other) => other !== account && other.code.startsWith(account.code)),
              account.code,
            ).toBe(false);
          }
        }
      });

      it('has Arabic and English names on every account', () => {
        for (const account of accounts) {
          expect(account.name.trim().length, account.code).toBeGreaterThan(0);
          expect(account.name).toMatch(/[؀-ۿ]/);
          expect(account.nameLatin.trim().length, account.code).toBeGreaterThan(0);
          expect(account.nameLatin).toMatch(/^[\x20-\x7E—']+$/);
        }
      });

      it('sets each of the six roles once, on an account that fits it', () => {
        const roles = accounts.flatMap((account) => (account.role === null ? [] : [account]));
        expect(roles.map((account) => account.role).sort()).toEqual([...ACCOUNT_ROLES].sort());
        for (const account of roles) {
          expect(
            accountRoleFits(account.role as (typeof ACCOUNT_ROLES)[number], {
              kind: account.kind,
              class: accountClassOfCode(account.code),
            }),
            account.code,
          ).toBe(true);
        }
      });

      it('requires a contract only together with its client', () => {
        for (const account of accounts) {
          if (account.requiredDimensions.includes('contract')) {
            expect(account.requiredDimensions, account.code).toContain('client');
          }
        }
      });
    });
  }

  it('makes the general chart from the service-agency chart with the listed differences', () => {
    const agency = chartTemplate('service-agency').accounts;
    const general = chartTemplate('general').accounts;
    const agencyCodes = new Set(agency.map((account) => account.code));
    const generalCodes = new Set(general.map((account) => account.code));
    expect([...agencyCodes].filter((code) => !generalCodes.has(code))).toEqual([
      '111005',
      '111006',
      '113',
      '113001',
      '211002',
      '213',
      '213001',
      '411002',
    ]);
    expect([...generalCodes].filter((code) => !agencyCodes.has(code))).toEqual([]);
    const find = (code: string) => general.find((account) => account.code === code);
    expect(find('211001')).toMatchObject({ name: 'ذمم الموردين', requiredDimensions: [] });
    expect(find('511')).toMatchObject({ kind: 'header', name: 'تكلفة المبيعات والخدمات' });
    expect(find('511001')).toMatchObject({
      statementLine: 'is.direct_costs',
      requiredDimensions: [],
    });
    expect(find('212001')?.requiredDimensions).toEqual(['client']);
    expect(find('411001')?.requiredDimensions).toEqual(['client']);
    for (const account of general) {
      for (const dimension of ['contract', 'department', 'service'] as const) {
        expect(account.requiredDimensions, account.code).not.toContain(dimension);
      }
    }
  });

  it('keeps the service-agency chart of S02, account by account', () => {
    const agency = chartTemplate('service-agency').accounts;
    expect(agency).toHaveLength(91);
    expect(agency.filter((account) => account.kind === 'postable')).toHaveLength(52);
    expect(agency.find((account) => account.code === '213001')).toEqual({
      code: '213001',
      name: 'أمانات إعلانات العملاء',
      nameLatin: 'Client ad funds held',
      kind: 'postable',
      normalBalance: 'credit',
      isMonetary: true,
      isControl: true,
      currency: 'USD',
      requiredDimensions: ['client'],
      statementLine: 'bs.client_money',
      role: null,
    });
    expect(agency.find((account) => account.code === '121003')?.normalBalance).toBe('credit');
  });
});
