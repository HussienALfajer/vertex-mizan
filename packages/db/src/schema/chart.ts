import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  archivedAt,
  companyId,
  createdAt,
  id,
  idIsUuidV7,
  timestamptz,
  updatedAt,
} from './columns.js';
import { companies, SETTINGS_CURRENCY_CODES } from './companies.js';
import { dimensionTypes } from './dimensions.js';

// The chart module (S02, ADR 0011): the chart of accounts, the dimensions each account requires
// and the account roles, company tables under forced RLS. `chart_accounts` is named apart from
// Better Auth's `accounts` (the sign-in accounts of `access.ts`). The five roots are made with
// every company by `create_company_chart_roots()`; the tree, the lock after first use and the role
// fit are the triggers of the S02 guards migration, pinned in `GUARDS`.

/** `ACCOUNT_ROLES` of `@vertex-mizan/contracts`; values are never renamed. */
export const accountRole = pgEnum('account_role', [
  'conversion_rounding',
  'fx_realised_gain',
  'fx_realised_loss',
  'fx_unrealised_gain',
  'fx_unrealised_loss',
  'retained_earnings',
]);

/**
 * The statement-line codes of `STATEMENT_LINES` in `@vertex-mizan/contracts`, by statement; a test
 * keeps them equal. A new line extends the check in a migration of its own.
 */
export const CHART_STATEMENT_LINES = {
  balance_sheet: [
    'bs.cash',
    'bs.trade_receivables',
    'bs.contract_assets',
    'bs.other_current_assets',
    'bs.ppe',
    'bs.trade_payables',
    'bs.contract_liabilities',
    'bs.client_money',
    'bs.tax_liabilities',
    'bs.accruals',
    'bs.share_capital',
    'bs.retained_earnings',
    'bs.owner_current',
  ],
  income_statement: [
    'is.revenue',
    'is.other_income',
    'is.direct_costs',
    'is.employee_benefits',
    'is.depreciation',
    'is.other_expenses',
    'is.fx_differences',
    'is.finance_costs',
    'is.income_tax',
  ],
} as const;

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/**
 * An account of the chart (S02 "Accounts"): the code shape and class (check 1), headers and
 * postable accounts (2), the statement line (3) and the flags (4) are checks here; the parent, the
 * lock after first use (5) and the roots are the `chart_account_rules()` trigger.
 */
export const chartAccounts = pgTable(
  'chart_accounts',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    code: text().notNull(),
    level: smallint().notNull(),
    parentId: uuid(),
    kind: text().notNull(),
    class: text().notNull(),
    name: text().notNull(),
    nameLatin: text(),
    normalBalance: text().notNull(),
    statementLine: text(),
    currency: text(),
    isControl: boolean().notNull().default(false),
    isMonetary: boolean().notNull().default(false),
    blockedAt: timestamptz(),
    blockedReason: text(),
    /** Set by the posting function at the account's first posted line (S03). */
    firstPostedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
    archivedReason: text(),
  },
  (t) => [
    idIsUuidV7('chart_accounts', t.id),
    unique('chart_accounts_company_id_id_key').on(t.companyId, t.id),
    unique('chart_accounts_company_id_code_key').on(t.companyId, t.code),
    foreignKey({
      name: 'chart_accounts_parent_fk',
      columns: [t.companyId, t.parentId],
      foreignColumns: [t.companyId, t.id],
    }),
    index('chart_accounts_company_parent_idx').on(t.companyId, t.parentId),
    check('chart_accounts_kind', sql`${t.kind} in ('header', 'postable')`),
    check(
      'chart_accounts_class',
      sql`${t.class} in ('asset', 'liability', 'equity', 'revenue', 'expense')`,
    ),
    check('chart_accounts_normal_balance', sql`${t.normalBalance} in ('debit', 'credit')`),
    // Check 1 (ADR 0011): 1, 2, 3 or 6 digits, each level adding to its parent's code, the class
    // from the first digit.
    check(
      'chart_accounts_code_shape',
      sql`(${t.level} = 1 and ${t.code} ~ '^[1-5]$')
        or (${t.level} = 2 and ${t.code} ~ '^[1-5][1-9]$')
        or (${t.level} = 3 and ${t.code} ~ '^[1-5][1-9][1-9]$')
        or (${t.level} = 4 and ${t.code} ~ '^[1-5][1-9][1-9][0-9]{3}$' and right(${t.code}, 3) <> '000')`,
    ),
    check(
      'chart_accounts_class_of_code',
      sql`(${t.class} = case left(${t.code}, 1) when '1' then 'asset' when '2' then 'liability'
        when '3' then 'equity' when '4' then 'revenue' when '5' then 'expense' end) is true`,
    ),
    check('chart_accounts_parent_by_level', sql`(${t.level} = 1) = (${t.parentId} is null)`),
    // Check 2: levels 1 and 2 are headers.
    check('chart_accounts_postable_level', sql`${t.kind} = 'header' or ${t.level} >= 3`),
    // Check 3: a statement line exactly on postable accounts, fitting the class.
    check(
      'chart_accounts_statement_line',
      sql`(${t.kind} = 'postable') = (${t.statementLine} is not null)
        and (${t.statementLine} is null
          or (${t.class} in ('asset', 'liability', 'equity')
            and ${t.statementLine} in (${listed(CHART_STATEMENT_LINES.balance_sheet)}))
          or (${t.class} in ('revenue', 'expense')
            and ${t.statementLine} in (${listed(CHART_STATEMENT_LINES.income_statement)})))`,
    ),
    // Check 4: flags on assets and liabilities only; headers carry no flag or currency.
    check(
      'chart_accounts_flags',
      sql`(not (${t.isControl} or ${t.isMonetary}) or ${t.class} in ('asset', 'liability'))
        and (${t.kind} = 'postable' or (not ${t.isControl} and not ${t.isMonetary} and ${t.currency} is null))`,
    ),
    check(
      'chart_accounts_currency',
      sql`${t.currency} is null or ${t.currency} in (${listed(SETTINGS_CURRENCY_CODES)})`,
    ),
    check('chart_accounts_name_length', sql`char_length(${t.name}) between 1 and 200`),
    check(
      'chart_accounts_name_latin_length',
      sql`${t.nameLatin} is null or char_length(${t.nameLatin}) between 1 and 200`,
    ),
    // Only a postable account is blocked or posted to.
    check(
      'chart_accounts_postable_states',
      sql`${t.kind} = 'postable' or (${t.blockedAt} is null and ${t.firstPostedAt} is null)`,
    ),
    // Check 6: a reason exactly with blocking and archiving.
    check(
      'chart_accounts_blocked_with_reason',
      sql`(${t.blockedAt} is null) = (${t.blockedReason} is null)
        and (${t.blockedReason} is null or char_length(${t.blockedReason}) between 1 and 1000)`,
    ),
    check(
      'chart_accounts_archived_with_reason',
      sql`(${t.archivedAt} is null) = (${t.archivedReason} is null)
        and (${t.archivedReason} is null or char_length(${t.archivedReason}) between 1 and 1000)`,
    ),
  ],
);

/** A dimension type a postable account requires on every line (S02 rule 8). */
export const accountRequiredDimensions = pgTable(
  'account_required_dimensions',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    accountId: uuid().notNull(),
    dimensionTypeId: uuid().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('account_required_dimensions', t.id),
    foreignKey({
      name: 'account_required_dimensions_account_fk',
      columns: [t.companyId, t.accountId],
      foreignColumns: [chartAccounts.companyId, chartAccounts.id],
    }),
    foreignKey({
      name: 'account_required_dimensions_type_fk',
      columns: [t.companyId, t.dimensionTypeId],
      foreignColumns: [dimensionTypes.companyId, dimensionTypes.id],
    }),
    index('account_required_dimensions_company_account_idx').on(t.companyId, t.accountId),
    index('account_required_dimensions_company_type_idx').on(t.companyId, t.dimensionTypeId),
    uniqueIndex('account_required_dimensions_active_key')
      .on(t.companyId, t.accountId, t.dimensionTypeId)
      .where(sql`${t.archivedAt} is null`),
  ],
);

/** The account of each role (S02 rule 7); one active row per role. */
export const accountRoles = pgTable(
  'account_roles',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    role: accountRole().notNull(),
    accountId: uuid().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('account_roles', t.id),
    foreignKey({
      name: 'account_roles_account_fk',
      columns: [t.companyId, t.accountId],
      foreignColumns: [chartAccounts.companyId, chartAccounts.id],
    }),
    index('account_roles_company_account_idx').on(t.companyId, t.accountId),
    uniqueIndex('account_roles_active_key')
      .on(t.companyId, t.role)
      .where(sql`${t.archivedAt} is null`),
  ],
);
