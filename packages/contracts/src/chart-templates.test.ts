import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_ROLES,
  accountClassOfCode,
  accountCodeLevel,
  accountRoleFits,
  canBeCashAccount,
  checkAccountShape,
  ROOT_ACCOUNTS,
} from './chart.js';
import { CHART_TEMPLATES, chartTemplate } from './chart-templates.js';

describe('the chart templates (S02 "Templates" after the review of Q3, S11 "Templates")', () => {
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
            code: account.code,
            level,
            kind: account.kind,
            class: accountClassOfCode(account.code),
            statementLine: account.statementLine,
            currency: account.currency,
            isControl: account.isControl,
            itemKind: account.itemKind,
            counterpartyType: account.counterpartyType,
            cashKind: account.cashKind,
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

      it('gives each control account a counterparty type it requires (S11 rule 5)', () => {
        for (const account of accounts) {
          expect(account.counterpartyType !== null, account.code).toBe(account.isControl);
          if (account.counterpartyType !== null) {
            expect(account.requiredDimensions, account.code).toContain(account.counterpartyType);
          }
        }
      });

      it('puts a cash kind only on an account that can carry it (S11 "Data")', () => {
        for (const account of accounts) {
          if (account.cashKind === null) continue;
          expect(
            canBeCashAccount({ ...account, class: accountClassOfCode(account.code) }),
            account.code,
          ).toBe(true);
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

  it('applies the review of 2026-11-13 to the general chart (E1, E2, A1–A14)', () => {
    for (const template of [chartTemplate('general')]) {
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

  it('gives each control account its item kind (S04) and counterparty type (S11)', () => {
    const kinds = chartTemplate('general')
      .accounts.filter((account) => account.isControl || account.itemKind !== null)
      .map((account) => [account.code, account.itemKind, account.counterpartyType]);
    expect(kinds).toEqual([['112001', 'document', 'client']]);
    expect(
      chartTemplate('general').accounts.filter((account) => account.cashKind !== null),
    ).toEqual([]);
  });

  describe('contracting@1 (S11 "Templates", N5)', () => {
    const contracting = chartTemplate('contracting');
    const general = chartTemplate('general');
    const find = (code: string) => {
      const account = contracting.accounts.find((candidate) => candidate.code === code);
      if (account === undefined) throw new Error(`contracting has no ${code}`);
      return account;
    };

    it('is version 1, named, with 128 accounts of which 84 postable', () => {
      expect([contracting.version, contracting.name, contracting.nameLatin]).toEqual([
        1,
        'مقاولات',
        'Contracting',
      ]);
      expect(contracting.accounts).toHaveLength(128);
      expect(contracting.accounts.filter((account) => account.kind === 'postable')).toHaveLength(
        84,
      );
    });

    it('marks five cash accounts: a box per currency and the two banks', () => {
      expect(
        contracting.accounts
          .filter((account) => account.cashKind !== null)
          .map((account) => [account.code, account.currency, account.cashKind]),
      ).toEqual([
        ['111001', 'SYP', 'box'],
        ['111002', 'USD', 'box'],
        ['111003', 'SYP', 'bank'],
        ['111004', 'USD', 'bank'],
        ['111005', 'TRY', 'box'],
      ]);
    });

    it('has the control accounts of ADR 0022 with their kinds, counterparties and monetary flags', () => {
      expect(
        contracting.accounts
          .filter((account) => account.isControl)
          .map((account) => [
            account.code,
            account.itemKind,
            account.counterpartyType,
            account.isMonetary,
            account.requiredDimensions,
          ]),
      ).toEqual([
        ['112001', 'document', 'client', true, ['client', 'contract']],
        ['113001', 'document', 'client', true, ['client', 'contract']],
        ['113002', 'document', 'client', true, ['client', 'contract']],
        // Advances are non-monetary (IAS 21.16, IFRIC 22).
        ['114002', 'running', 'supplier', false, ['supplier', 'contract']],
        ['211001', 'running', 'supplier', true, ['supplier']],
        ['211002', 'running', 'supplier', true, ['supplier']],
        ['211006', 'running', 'supplier', true, ['supplier', 'contract']],
        ['211007', 'running', 'worker', true, ['worker']],
        ['212002', 'running', 'client', false, ['client', 'contract']],
      ]);
    });

    it('requires the contract on project costs and contract revenue, not on office costs (rule 3)', () => {
      for (const code of ['511001', '511002', '511003', '511004', '511005', '511006']) {
        expect(find(code), code).toMatchObject({
          statementLine: 'is.direct_costs',
          requiredDimensions: ['contract'],
        });
      }
      expect(find('411001').requiredDimensions).toEqual(['client', 'contract']);
      expect(find('212001').requiredDimensions).toEqual(['client', 'contract']);
      for (const account of contracting.accounts) {
        if (account.code.startsWith('5') && !account.code.startsWith('51')) {
          expect(account.requiredDimensions, account.code).toEqual([]);
        }
      }
    });

    it('keeps general@3 for every code both share, but those the spec lists (rule 2)', () => {
      const differing = new Set([
        '121001',
        '121005',
        '121006',
        '121007',
        '121008',
        '211001',
        '211002',
        '211006',
        '211007',
        '212002',
        '411001',
        '422002',
        '511001',
        '511002',
        '511003',
        '511004',
        '511005',
        '511006',
        '532004',
        '532007',
        '533004',
        '533005',
      ]);
      const contractingCodes = new Set(contracting.accounts.map((account) => account.code));
      const meaning = (candidate: (typeof general.accounts)[number]) => [
        candidate.kind,
        candidate.normalBalance,
        candidate.isMonetary,
        candidate.currency,
        candidate.statementLine,
        candidate.role,
      ];
      for (const account of general.accounts) {
        expect(contractingCodes.has(account.code), account.code).toBe(true);
        if (differing.has(account.code)) continue;
        expect(meaning(find(account.code)), account.code).toEqual(meaning(account));
      }
    });

    it('books cash shortages and overages on their own accounts', () => {
      expect(find('532007')).toMatchObject({
        name: 'عجز الصناديق',
        statementLine: 'is.other_expenses',
      });
      expect(find('422002')).toMatchObject({
        name: 'زيادة الصناديق',
        statementLine: 'is.other_income',
      });
      expect(find('532002').name).toBe('الرسوم المصرفية وعمولات التحويل');
    });
  });
});
