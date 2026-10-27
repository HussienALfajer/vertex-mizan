import { z } from 'zod';
import { DomainError } from './errors.js';
import { type CurrencyCode, currencyCodeSchema } from './money.js';

/**
 * The chart of accounts (S02, ADR 0011): four levels with codes of 1, 2, 3 and 6 digits, the class
 * from the first digit, headers and postable accounts, the statement-line catalogue (by nature,
 * with IFRS 18 categories) and the account roles the posting function and revaluation need.
 */

/** The class of an account, from its code's first digit: 1 asset … 5 expense. */
export const ACCOUNT_CLASSES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;

export const accountClassSchema = z.enum(ACCOUNT_CLASSES).meta({ id: 'AccountClass' });

export type AccountClass = z.infer<typeof accountClassSchema>;

/** A header groups accounts; a postable account (a leaf at level 3 or 4) carries lines. */
export const ACCOUNT_KINDS = ['header', 'postable'] as const;

export const accountKindSchema = z.enum(ACCOUNT_KINDS).meta({ id: 'AccountKind' });

export type AccountKind = z.infer<typeof accountKindSchema>;

export const NORMAL_BALANCES = ['debit', 'credit'] as const;

export const normalBalanceSchema = z.enum(NORMAL_BALANCES).meta({ id: 'NormalBalance' });

export type NormalBalance = z.infer<typeof normalBalanceSchema>;

export type AccountLevel = 1 | 2 | 3 | 4;

/**
 * The accounts the posting function and revaluation look up by role (S02 rule 7). Stored in the
 * `account_role` enum; values are never renamed.
 */
export const ACCOUNT_ROLES = [
  'conversion_rounding',
  'fx_realised_gain',
  'fx_realised_loss',
  'fx_unrealised_gain',
  'fx_unrealised_loss',
  'retained_earnings',
] as const;

export const accountRoleSchema = z.enum(ACCOUNT_ROLES).meta({ id: 'AccountRole' });

export type AccountRole = z.infer<typeof accountRoleSchema>;

/** The five root accounts every company has from its creation; they can only be renamed. */
export const ROOT_ACCOUNTS = [
  { code: '1', class: 'asset', name: 'الأصول', nameLatin: 'Assets' },
  { code: '2', class: 'liability', name: 'الخصوم', nameLatin: 'Liabilities' },
  { code: '3', class: 'equity', name: 'حقوق الملكية', nameLatin: 'Equity' },
  { code: '4', class: 'revenue', name: 'الإيرادات', nameLatin: 'Revenue' },
  { code: '5', class: 'expense', name: 'المصاريف', nameLatin: 'Expenses' },
] as const satisfies readonly {
  code: string;
  class: AccountClass;
  name: string;
  nameLatin: string;
}[];

// The code shape (ADR 0011): one digit 1–5; then one digit 1–9; then one digit 1–9; then 001–999.
const CODE_SHAPES: Readonly<Record<AccountLevel, RegExp>> = {
  1: /^[1-5]$/,
  2: /^[1-5][1-9]$/,
  3: /^[1-5][1-9]{2}$/,
  4: /^[1-5][1-9]{2}(?!000)\d{3}$/,
};

/** The level a code's shape gives it, or null when it fits no level. */
export function accountCodeLevel(code: string): AccountLevel | null {
  for (const level of [1, 2, 3, 4] as const) if (CODE_SHAPES[level].test(code)) return level;
  return null;
}

/** The code of the parent a well-shaped code needs, null at level 1. */
export function parentAccountCode(code: string): string | null {
  const level = accountCodeLevel(code);
  if (level === null) throw new RangeError(`Not an account code: ${code}`);
  return level === 1 ? null : code.slice(0, level === 4 ? 3 : level - 1);
}

/** The class of a code's first digit. */
export function accountClassOfCode(code: string): AccountClass {
  const index = Number(code[0]) - 1;
  const accountClass = ACCOUNT_CLASSES[index];
  if (accountClass === undefined || accountCodeLevel(code) === null) {
    throw new RangeError(`Not an account code: ${code}`);
  }
  return accountClass;
}

/** The normal balance a new account takes by default: debit for assets and expenses. */
export function defaultNormalBalance(accountClass: AccountClass): NormalBalance {
  return accountClass === 'asset' || accountClass === 'expense' ? 'debit' : 'credit';
}

/**
 * An account code as typed: digits only. Its shape (1, 2, 3 or 6 digits extending the parent's) is
 * checked against its parent by `checkAccountCode`, so a code of the wrong length answers
 * `ACCOUNT_CODE_INVALID` like any other misfit (S02 "Acceptance" step 2).
 */
export const accountCodeSchema = z
  .string()
  .regex(/^\d{1,12}$/, 'Expected digits')
  .meta({ id: 'AccountCode' });

/** The parent an account is placed under, as the chart holds it. */
export interface ParentAccount {
  readonly code: string;
  readonly level: AccountLevel;
  readonly kind: AccountKind;
}

/**
 * Checks a new or moved account's code against its parent (S02 rules 2–3, ADR 0011) and returns
 * its level: `ACCOUNT_CODE_INVALID` when the code breaks the shape, is a root (roots are made with
 * the company) or does not extend the parent's code; `ACCOUNT_NOT_HEADER` under a postable parent.
 */
export function checkAccountCode(code: string, parent: ParentAccount): AccountLevel {
  const level = accountCodeLevel(code);
  if (level === null || level === 1 || parentAccountCode(code) !== parent.code) {
    throw new DomainError('ACCOUNT_CODE_INVALID', `Account code ${code} does not fit its parent`, {
      code,
      parentCode: parent.code,
    });
  }
  if (parent.kind !== 'header') {
    throw new DomainError('ACCOUNT_NOT_HEADER', `Account ${parent.code} is postable`, {
      parentCode: parent.code,
    });
  }
  return level;
}

/** The financial statements the catalogue presents. */
export const STATEMENTS = ['balance_sheet', 'income_statement'] as const;

export type Statement = (typeof STATEMENTS)[number];

export const STATEMENT_SECTIONS = [
  'current_assets',
  'non_current_assets',
  'current_liabilities',
  'equity',
  'profit_or_loss',
] as const;

export type StatementSection = (typeof STATEMENT_SECTIONS)[number];

/** The IFRS 18 categories of the income statement (periods from 2027-01-01). */
export const IFRS18_CATEGORIES = ['operating', 'investing', 'financing', 'income_taxes'] as const;

export type Ifrs18Category = (typeof IFRS18_CATEGORIES)[number];

export interface StatementLine {
  readonly code: string;
  readonly statement: Statement;
  readonly section: StatementSection;
  /** The presentation order within the statement. */
  readonly order: number;
  /** Income-statement lines only. */
  readonly ifrs18Category: Ifrs18Category | null;
  readonly name: string;
  readonly nameLatin: string;
  /** The standard that asks for the line. */
  readonly basis: string;
}

const line = (
  code: string,
  section: StatementSection,
  order: number,
  name: string,
  nameLatin: string,
  basis: string,
  ifrs18Category: Ifrs18Category | null = null,
): StatementLine => ({
  code,
  statement: section === 'profit_or_loss' ? 'income_statement' : 'balance_sheet',
  section,
  order,
  ifrs18Category,
  name,
  nameLatin,
  basis,
});

/**
 * The statement-line catalogue (S02 "The statement-line catalogue", ADR 0011): reports present
 * from it and postable accounts reference its codes. A new line is an additive change; a code is
 * never renamed or removed.
 */
export const STATEMENT_LINES: readonly StatementLine[] = [
  line(
    'bs.cash',
    'current_assets',
    1,
    'النقد وما يعادله',
    'Cash and cash equivalents',
    'IAS 1.54(i)',
  ),
  line(
    'bs.trade_receivables',
    'current_assets',
    2,
    'الذمم المدينة التجارية والأخرى',
    'Trade and other receivables',
    'IAS 1.54(h)',
  ),
  line('bs.contract_assets', 'current_assets', 3, 'أصول العقود', 'Contract assets', 'IFRS 15.105'),
  line(
    'bs.other_current_assets',
    'current_assets',
    4,
    'مصاريف مدفوعة مقدمًا وأصول متداولة أخرى',
    'Prepayments and other current assets',
    'IAS 1.55',
  ),
  line(
    'bs.ppe',
    'non_current_assets',
    5,
    'الممتلكات والمعدات',
    'Property and equipment',
    'IAS 1.54(a)',
  ),
  line(
    'bs.trade_payables',
    'current_liabilities',
    6,
    'الذمم الدائنة التجارية والأخرى',
    'Trade and other payables',
    'IAS 1.54(k)',
  ),
  line(
    'bs.contract_liabilities',
    'current_liabilities',
    7,
    'التزامات العقود',
    'Contract liabilities',
    'IFRS 15.105',
  ),
  line(
    'bs.client_money',
    'current_liabilities',
    8,
    'أمانات العملاء',
    'Client money held',
    'IAS 1.55',
  ),
  line(
    'bs.tax_liabilities',
    'current_liabilities',
    9,
    'التزامات الضرائب والرسوم الجارية',
    'Current tax and duty liabilities',
    'IAS 1.54(n)',
  ),
  line(
    'bs.accruals',
    'current_liabilities',
    10,
    'المصاريف المستحقة',
    'Accrued expenses',
    'IAS 1.55',
  ),
  line('bs.share_capital', 'equity', 11, 'رأس المال', 'Share capital', 'IAS 1.54(r)'),
  line(
    'bs.retained_earnings',
    'equity',
    12,
    'الأرباح المحتجزة',
    'Retained earnings',
    'IAS 1.54(r)',
  ),
  line('bs.owner_current', 'equity', 13, 'جاري المالك', "Owner's current account", 'IAS 1.55'),
  line(
    'is.revenue',
    'profit_or_loss',
    1,
    'إيرادات العقود مع العملاء',
    'Revenue from contracts with customers',
    'IFRS 15.113(a)',
    'operating',
  ),
  line(
    'is.other_income',
    'profit_or_loss',
    2,
    'إيرادات تشغيلية أخرى',
    'Other operating income',
    'IFRS 18.47',
    'operating',
  ),
  line(
    'is.direct_costs',
    'profit_or_loss',
    3,
    'تكاليف المشاريع والخدمات المباشرة',
    'Direct project and service costs',
    'IAS 1.102',
    'operating',
  ),
  line(
    'is.employee_benefits',
    'profit_or_loss',
    4,
    'مصاريف الموظفين',
    'Employee benefits expense',
    'IAS 1.102',
    'operating',
  ),
  line(
    'is.depreciation',
    'profit_or_loss',
    5,
    'الاستهلاك',
    'Depreciation',
    'IAS 1.102',
    'operating',
  ),
  line(
    'is.other_expenses',
    'profit_or_loss',
    6,
    'مصاريف تشغيلية أخرى',
    'Other operating expenses',
    'IAS 1.102',
    'operating',
  ),
  line(
    'is.fx_differences',
    'profit_or_loss',
    7,
    'صافي فروق الصرف',
    'Net foreign exchange differences',
    'IAS 21.52(a); IFRS 18.B65',
    'operating',
  ),
  line(
    'is.finance_costs',
    'profit_or_loss',
    8,
    'تكاليف التمويل',
    'Finance costs',
    'IAS 1.82(b)',
    'financing',
  ),
  line(
    'is.income_tax',
    'profit_or_loss',
    9,
    'مصروف ضريبة الدخل',
    'Income tax expense',
    'IAS 1.82(d)',
    'income_taxes',
  ),
];

export const statementLineSchema = z
  .object({
    code: z.string(),
    statement: z.enum(STATEMENTS),
    section: z.enum(STATEMENT_SECTIONS),
    order: z.int(),
    ifrs18Category: z.enum(IFRS18_CATEGORIES).nullable(),
    name: z.string(),
    nameLatin: z.string(),
    basis: z.string(),
  })
  .meta({ id: 'StatementLine' });

/** A statement-line code as an account carries it; its fit is checked with `checkStatementLine`. */
export const statementLineCodeSchema = z.string().min(1).max(60).meta({ id: 'StatementLineCode' });

/** Whether a catalogue line fits a class: the balance sheet for 1–3, the income statement for 4–5. */
export function statementLineFits(code: string, accountClass: AccountClass): boolean {
  const found = STATEMENT_LINES.find((candidate) => candidate.code === code);
  if (found === undefined) return false;
  const balanceSheet =
    accountClass === 'asset' || accountClass === 'liability' || accountClass === 'equity';
  return found.statement === (balanceSheet ? 'balance_sheet' : 'income_statement');
}

/** The fields of an account that S02's rules 2–4 hold together. */
export interface AccountShape {
  readonly level: AccountLevel;
  readonly kind: AccountKind;
  readonly class: AccountClass;
  readonly statementLine: string | null;
  readonly currency: CurrencyCode | null;
  readonly isControl: boolean;
  readonly isMonetary: boolean;
  readonly requiredDimensionCount: number;
}

/**
 * Checks S02 checks 2–4 on an account: levels 1 and 2 are headers; a statement line exactly on a
 * postable account, from the catalogue and fitting the class (`STATEMENT_LINE_INVALID`); headers
 * carry no flag, currency or required dimension, and only assets and liabilities are monetary or
 * control accounts (`VALIDATION_FAILED`). Whether a postable account is a leaf is the chart's.
 */
export function checkAccountShape(account: AccountShape): void {
  const invalid = (message: string): never => {
    throw new DomainError('VALIDATION_FAILED', message);
  };
  if (account.kind === 'postable' && account.level < 3) {
    invalid('Levels 1 and 2 are header accounts');
  }
  if (account.kind === 'header') {
    if (account.statementLine !== null) {
      throw new DomainError('STATEMENT_LINE_INVALID', 'A header account has no statement line');
    }
    if (
      account.currency !== null ||
      account.isControl ||
      account.isMonetary ||
      account.requiredDimensionCount > 0
    ) {
      invalid('A header account has no currency, flag or required dimension');
    }
    return;
  }
  if (account.statementLine === null || !statementLineFits(account.statementLine, account.class)) {
    throw new DomainError(
      'STATEMENT_LINE_INVALID',
      `Statement line ${account.statementLine} does not fit a ${account.class} account`,
      { statementLine: account.statementLine },
    );
  }
  if (
    (account.isControl || account.isMonetary) &&
    !['asset', 'liability'].includes(account.class)
  ) {
    invalid('Only assets and liabilities are monetary or control accounts');
  }
}

/**
 * Whether an account fits a role (S02 rule 7): a postable account; conversion rounding on revenue
 * or expense, gains on revenue, losses on expense, retained earnings on equity. Blocking and
 * archiving are checked where the account's state is known.
 */
export function accountRoleFits(
  role: AccountRole,
  account: { readonly kind: AccountKind; readonly class: AccountClass },
): boolean {
  if (account.kind !== 'postable') return false;
  switch (role) {
    case 'conversion_rounding':
      return account.class === 'revenue' || account.class === 'expense';
    case 'fx_realised_gain':
    case 'fx_unrealised_gain':
      return account.class === 'revenue';
    case 'fx_realised_loss':
    case 'fx_unrealised_loss':
      return account.class === 'expense';
    case 'retained_earnings':
      return account.class === 'equity';
  }
}

/** An account's Arabic name, or its optional Latin name: 1–200 characters after trimming. */
const accountNameSchema = z.string().trim().min(1).max(200);

/** When and why an account was blocked or archived. */
const stateSchema = z.object({ at: z.iso.datetime({ offset: true }), reason: z.string() });

/** An account as the API returns it (`GET /api/accounts`). */
export const accountSchema = z
  .object({
    id: z.uuid(),
    code: z.string(),
    level: z.int().min(1).max(4),
    parentId: z.uuid().nullable(),
    kind: accountKindSchema,
    class: accountClassSchema,
    name: z.string(),
    nameLatin: z.string().nullable(),
    normalBalance: normalBalanceSchema,
    statementLine: z.string().nullable(),
    currency: currencyCodeSchema.nullable(),
    isControl: z.boolean(),
    isMonetary: z.boolean(),
    requiredDimensionTypeIds: z.array(z.uuid()),
    roles: z.array(accountRoleSchema),
    blocked: stateSchema.nullable(),
    archived: stateSchema.nullable(),
    /** The first posted line (S03): the locked fields of S02 rule 4 then never change. */
    firstPostedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Account' });

export type Account = z.infer<typeof accountSchema>;

/** `GET /api/accounts`: archived accounts only on request. */
export const accountQuerySchema = z
  .object({ includeArchived: z.enum(['true', 'false']).optional() })
  .meta({ id: 'AccountQuery' });

export type AccountQuery = z.infer<typeof accountQuerySchema>;

const requiredDimensionTypeIdsSchema = z
  .array(z.uuid())
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, 'Each dimension type once');

/**
 * `POST /api/accounts`: a new account under a header. The normal balance defaults by class; the
 * flags, currency and required dimensions are for postable accounts only.
 */
export const createAccountSchema = z
  .object({
    parentId: z.uuid(),
    code: accountCodeSchema,
    kind: accountKindSchema,
    name: accountNameSchema,
    nameLatin: accountNameSchema.nullable().default(null),
    normalBalance: normalBalanceSchema.optional(),
    statementLine: statementLineCodeSchema.nullable().default(null),
    currency: currencyCodeSchema.nullable().default(null),
    isControl: z.boolean().default(false),
    isMonetary: z.boolean().default(false),
    requiredDimensionTypeIds: requiredDimensionTypeIdsSchema.default([]),
  })
  .meta({ id: 'CreateAccount' });

export type CreateAccount = z.infer<typeof createAccountSchema>;

/**
 * `PATCH /api/accounts/:id`: any field before first use, the code only with a valid parent; after
 * first use the names, the statement line and the required dimensions (`ACCOUNT_LOCKED`).
 */
export const updateAccountSchema = z
  .object({
    parentId: z.uuid().optional(),
    code: accountCodeSchema.optional(),
    kind: accountKindSchema.optional(),
    name: accountNameSchema.optional(),
    nameLatin: accountNameSchema.nullable().optional(),
    normalBalance: normalBalanceSchema.optional(),
    statementLine: statementLineCodeSchema.nullable().optional(),
    currency: currencyCodeSchema.nullable().optional(),
    isControl: z.boolean().optional(),
    isMonetary: z.boolean().optional(),
    requiredDimensionTypeIds: requiredDimensionTypeIdsSchema.optional(),
  })
  .refine((change) => Object.values(change).some((value) => value !== undefined), {
    message: 'Nothing to change',
  })
  .meta({ id: 'UpdateAccount' });

export type UpdateAccount = z.infer<typeof updateAccountSchema>;

/** `PUT /api/account-roles`: one role to one account. */
export const setAccountRoleSchema = z
  .object({ role: accountRoleSchema, accountId: z.uuid() })
  .meta({ id: 'SetAccountRole' });

export type SetAccountRole = z.infer<typeof setAccountRoleSchema>;

/** `GET /api/account-roles`: each of the six roles with its account, null when not set. */
export const accountRoleAssignmentSchema = z
  .object({ role: accountRoleSchema, accountId: z.uuid().nullable() })
  .meta({ id: 'AccountRoleAssignment' });

export type AccountRoleAssignment = z.infer<typeof accountRoleAssignmentSchema>;

/** The chart templates (`chart-templates.ts`). */
export const CHART_TEMPLATE_IDS = ['service-agency', 'general'] as const;

export const chartTemplateIdSchema = z.enum(CHART_TEMPLATE_IDS).meta({ id: 'ChartTemplateId' });

export type ChartTemplateId = z.infer<typeof chartTemplateIdSchema>;

/** `GET /api/chart/templates`: a template's summary. */
export const chartTemplateSummarySchema = z
  .object({
    id: chartTemplateIdSchema,
    version: z.int().min(1),
    name: z.string(),
    nameLatin: z.string(),
    accountCount: z.int(),
  })
  .meta({ id: 'ChartTemplateSummary' });

export type ChartTemplateSummary = z.infer<typeof chartTemplateSummarySchema>;

/** `POST /api/chart/apply-template`: to a chart that holds the five roots alone. */
export const applyChartTemplateSchema = z
  .object({ templateId: chartTemplateIdSchema })
  .meta({ id: 'ApplyChartTemplate' });

export type ApplyChartTemplate = z.infer<typeof applyChartTemplateSchema>;

/**
 * `GET /api/chart/export`: the chart as a file. Excel for now; the PDF joins with the worker's
 * rendering (owner, 2026-10-27: ADR 0002 renders PDFs in the worker), an additive change.
 */
export const chartExportQuerySchema = z
  .object({ format: z.enum(['xlsx']) })
  .meta({ id: 'ChartExportQuery' });

export type ChartExportQuery = z.infer<typeof chartExportQuerySchema>;
