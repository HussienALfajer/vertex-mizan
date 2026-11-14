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

describe('the chart templates (S02 "Templates", version 3 after the review of Q3)', () => {
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
            itemKind: account.itemKind,
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

      it('sets each of the seven roles once, on an account that fits it', () => {
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

  it('keeps the general chart of S02 with the listed accounts, account by account', () => {
    const general = chartTemplate('general').accounts;
    expect(general).toHaveLength(107);
    expect(general.filter((account) => account.kind === 'postable')).toHaveLength(64);
    const find = (code: string) => general.find((account) => account.code === code);
    expect(find('211001')).toMatchObject({ name: 'ذمم الموردين', requiredDimensions: [] });
    expect(find('511')).toMatchObject({ kind: 'header', name: 'تكلفة المبيعات والخدمات' });
    expect(find('511001')).toMatchObject({
      statementLine: 'is.direct_costs',
      requiredDimensions: [],
    });
    expect(find('212001')?.requiredDimensions).toEqual(['client']);
    expect(find('411001')?.requiredDimensions).toEqual(['client']);
    expect(find('521003')?.requiredDimensions).toEqual([]);
    expect(find('312002')).toMatchObject({
      kind: 'postable',
      normalBalance: 'credit',
      statementLine: 'bs.retained_earnings',
      role: 'pre_opening_result',
    });
    expect(find('121003')?.normalBalance).toBe('credit');
    // A15 and A16: a company with legal personality (IAS 32.11, 32.16; IAS 1.54(r), 1.78(e)).
    expect(find('217001')).toMatchObject({
      kind: 'postable',
      normalBalance: 'credit',
      isMonetary: true,
      isControl: false,
      statementLine: 'bs.trade_payables',
    });
    expect(find('314001')).toMatchObject({
      kind: 'postable',
      normalBalance: 'credit',
      isMonetary: false,
      statementLine: 'bs.reserves',
    });
    expect(find('313001')).toMatchObject({
      statementLine: 'bs.owner_current',
      isMonetary: false,
    });
    for (const account of general) {
      for (const dimension of ['contract', 'department', 'service'] as const) {
        expect(account.requiredDimensions, account.code).not.toContain(dimension);
      }
    }
    // The agency's accounts left with the service-agency template (ADR 0021).
    for (const code of ['111005', '111006', '113', '113001', '211002', '213', '213001', '411002']) {
      expect(find(code), code).toBeUndefined();
    }
  });

  it('applies the review of 2026-11-13 to both templates (E1, E2, A1–A14)', () => {
    for (const template of CHART_TEMPLATES) {
      expect(template.version).toBe(3);
      const find = (code: string) => {
        const account = template.accounts.find((candidate) => candidate.code === code);
        if (account === undefined) throw new Error(`${template.id} has no ${code}`);
        return account;
      };
      const shape = (code: string) => {
        const account = find(code);
        return [
          account.statementLine,
          account.normalBalance,
          account.isMonetary,
          account.isControl,
          account.requiredDimensions,
        ];
      };
      // E1 and E2: the other taxes on their own line, no mark in the names.
      expect(find('214001').statementLine).toBe('bs.tax_liabilities');
      for (const code of ['214002', '214003', '214004', '214005']) {
        expect(shape(code), code).toEqual(['bs.other_taxes_payable', 'credit', true, false, []]);
      }
      for (const account of template.accounts) {
        expect(account.nameLatin, account.code).not.toContain('UNVERIFIED');
      }
      expect(shape('211004')).toEqual(['bs.trade_payables', 'credit', true, false, []]);
      expect(shape('521003')).toEqual(['is.employee_benefits', 'debit', false, false, []]);
      expect(shape('532005')).toEqual(['is.other_expenses', 'debit', false, false, []]);
      expect(shape('112003')).toEqual(['bs.trade_receivables', 'debit', true, false, []]);
      expect(shape('114002')).toEqual(['bs.other_current_assets', 'debit', false, false, []]);
      expect(shape('114003')).toEqual(['bs.other_current_assets', 'debit', true, false, []]);
      expect(shape('112009')).toEqual(['bs.trade_receivables', 'credit', true, false, ['client']]);
      expect(shape('532006')).toEqual(['is.impairment_losses', 'debit', false, false, []]);
      expect(find('122').kind).toBe('header');
      expect(shape('122001')).toEqual(['bs.intangible_assets', 'debit', false, false, []]);
      expect(shape('122002')).toEqual(['bs.intangible_assets', 'credit', false, false, []]);
      expect(shape('533003')).toEqual(['is.depreciation', 'debit', false, false, []]);
      expect(find('533').nameLatin).toBe('Depreciation and amortisation');
      expect([find('56').kind, find('561').kind]).toEqual(['header', 'header']);
      expect(shape('561001')).toEqual(['is.finance_costs', 'debit', false, false, []]);
      expect(find('216').kind).toBe('header');
      expect(shape('216001')).toEqual(['bs.borrowings', 'credit', true, false, []]);
      expect(shape('211005')).toEqual(['bs.trade_payables', 'credit', true, false, ['client']]);
    }
  });

  it('gives each control account its item kind (S04)', () => {
    const kinds = chartTemplate('general')
      .accounts.filter((account) => account.isControl || account.itemKind !== null)
      .map((account) => [account.code, account.itemKind]);
    expect(kinds).toEqual([['112001', 'document']]);
  });
});
