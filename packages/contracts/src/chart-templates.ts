import {
  type AccountKind,
  type AccountRole,
  accountClassOfCode,
  type ChartTemplateId,
  defaultNormalBalance,
  type NormalBalance,
} from './chart.js';
import type { BuiltinDimensionType } from './dimensions.js';
import type { CurrencyCode } from './money.js';

/**
 * The chart templates of S02 ("Templates", drafts until Syrian accountants review them, open
 * question Q3; their changes are a new version). Applied at company creation or to a chart that
 * holds the five roots alone. Accounts are in code order, so each parent comes before its children.
 */

export interface TemplateAccount {
  readonly code: string;
  readonly name: string;
  readonly nameLatin: string;
  readonly kind: AccountKind;
  readonly normalBalance: NormalBalance;
  readonly isMonetary: boolean;
  readonly isControl: boolean;
  readonly currency: CurrencyCode | null;
  readonly requiredDimensions: readonly BuiltinDimensionType[];
  readonly statementLine: string | null;
  readonly role: AccountRole | null;
}

export interface ChartTemplate {
  readonly id: ChartTemplateId;
  readonly version: number;
  readonly name: string;
  readonly nameLatin: string;
  readonly accounts: readonly TemplateAccount[];
}

/** A header: no flags, the class's normal balance. */
const h = (code: string, name: string, nameLatin: string): TemplateAccount => ({
  code,
  name,
  nameLatin,
  kind: 'header',
  normalBalance: defaultNormalBalance(accountClassOfCode(code)),
  isMonetary: false,
  isControl: false,
  currency: null,
  requiredDimensions: [],
  statementLine: null,
  role: null,
});

interface PostableOptions {
  readonly balance?: NormalBalance;
  readonly monetary?: boolean;
  readonly control?: boolean;
  readonly currency?: CurrencyCode;
  readonly dims?: readonly BuiltinDimensionType[];
  readonly role?: AccountRole;
}

/** A postable account with its statement line. */
const p = (
  code: string,
  name: string,
  nameLatin: string,
  statementLine: string,
  options: PostableOptions = {},
): TemplateAccount => ({
  code,
  name,
  nameLatin,
  kind: 'postable',
  normalBalance: options.balance ?? defaultNormalBalance(accountClassOfCode(code)),
  isMonetary: options.monetary ?? false,
  isControl: options.control ?? false,
  currency: options.currency ?? null,
  requiredDimensions: options.dims ?? [],
  statementLine,
  role: options.role ?? null,
});

const M = { monetary: true } as const;

/** `service-agency@1` (Vertex Media): S02 "Service agency". */
const serviceAgencyAccounts: readonly TemplateAccount[] = [
  h('1', 'الأصول', 'Assets'),
  h('11', 'الأصول المتداولة', 'Current assets'),
  h('111', 'النقد وما يعادله', 'Cash and cash equivalents'),
  p('111001', 'الصندوق — ليرة سورية', 'Cash on hand — SYP', 'bs.cash', { ...M, currency: 'SYP' }),
  p('111002', 'الصندوق — دولار أمريكي', 'Cash on hand — USD', 'bs.cash', { ...M, currency: 'USD' }),
  p('111003', 'الحساب المصرفي — ليرة سورية', 'Bank account — SYP', 'bs.cash', {
    ...M,
    currency: 'SYP',
  }),
  p('111004', 'الحساب المصرفي — دولار أمريكي', 'Bank account — USD', 'bs.cash', {
    ...M,
    currency: 'USD',
  }),
  p('111005', 'المحفظة الإلكترونية — ليرة سورية', 'E-wallet — SYP', 'bs.cash', {
    ...M,
    currency: 'SYP',
  }),
  p('111006', 'المحفظة الإلكترونية — دولار أمريكي', 'E-wallet — USD', 'bs.cash', {
    ...M,
    currency: 'USD',
  }),
  h('112', 'الذمم المدينة', 'Receivables'),
  p('112001', 'ذمم العملاء التجارية', 'Trade receivables', 'bs.trade_receivables', {
    ...M,
    control: true,
    dims: ['client'],
  }),
  p('112002', 'ذمم مدينة أخرى', 'Other receivables', 'bs.trade_receivables', M),
  h('113', 'أصول العقود', 'Contract assets'),
  p('113001', 'أصول العقود', 'Contract assets', 'bs.contract_assets', {
    ...M,
    control: true,
    dims: ['client', 'contract'],
  }),
  h('114', 'أصول متداولة أخرى', 'Other current assets'),
  p('114001', 'مصاريف مدفوعة مقدمًا', 'Prepaid expenses', 'bs.other_current_assets'),
  h('12', 'الأصول غير المتداولة', 'Non-current assets'),
  h('121', 'الممتلكات والمعدات', 'Property and equipment'),
  p('121001', 'أجهزة الحاسوب ومعدات التصوير', 'Computers and camera equipment', 'bs.ppe'),
  p('121002', 'الأثاث والمفروشات', 'Furniture and fittings', 'bs.ppe'),
  p(
    '121003',
    'مجمع استهلاك أجهزة الحاسوب ومعدات التصوير',
    'Accumulated depreciation — computers and equipment',
    'bs.ppe',
    { balance: 'credit' },
  ),
  p('121004', 'مجمع استهلاك الأثاث والمفروشات', 'Accumulated depreciation — furniture', 'bs.ppe', {
    balance: 'credit',
  }),
  h('2', 'الخصوم', 'Liabilities'),
  h('21', 'الخصوم المتداولة', 'Current liabilities'),
  h('211', 'الذمم الدائنة', 'Payables'),
  p('211001', 'ذمم منصات الإعلان', 'Ad platforms payable', 'bs.trade_payables', {
    ...M,
    dims: ['client'],
  }),
  p(
    '211002',
    'مصاريف مشاريع بانتظار مصدر الدفع',
    'Project expenses awaiting payment source',
    'bs.trade_payables',
    M,
  ),
  p('211003', 'ذمم دائنة أخرى', 'Other payables', 'bs.trade_payables', M),
  h('212', 'التزامات العقود', 'Contract liabilities'),
  p(
    '212001',
    'التزامات العقود (إيرادات مؤجلة)',
    'Contract liabilities (deferred revenue)',
    'bs.contract_liabilities',
    { dims: ['client', 'contract'] },
  ),
  h('213', 'أمانات العملاء', 'Client money held'),
  p('213001', 'أمانات إعلانات العملاء', 'Client ad funds held', 'bs.client_money', {
    ...M,
    control: true,
    currency: 'USD',
    dims: ['client'],
  }),
  h('214', 'الضرائب والرسوم المستحقة', 'Taxes and fees payable'),
  p('214001', 'ضريبة الدخل المستحقة', 'Income tax payable', 'bs.tax_liabilities', M),
  p(
    '214002',
    'رسم الإنفاق الاستهلاكي المستحق',
    'Consumption expenditure fee payable (UNVERIFIED)',
    'bs.tax_liabilities',
    M,
  ),
  p('214003', 'رسم الطابع المستحق', 'Stamp duty payable (UNVERIFIED)', 'bs.tax_liabilities', M),
  p(
    '214004',
    'ضريبة الرواتب والأجور المقتطعة',
    'Payroll tax withheld (UNVERIFIED)',
    'bs.tax_liabilities',
    M,
  ),
  h('215', 'المصاريف المستحقة', 'Accrued expenses'),
  p('215001', 'رواتب وأجور مستحقة', 'Accrued salaries and wages', 'bs.accruals', M),
  p('215002', 'مصاريف مستحقة أخرى', 'Other accrued expenses', 'bs.accruals', M),
  h('3', 'حقوق الملكية', 'Equity'),
  h('31', 'رأس المال والاحتياطيات', 'Capital and reserves'),
  h('311', 'رأس المال', 'Capital'),
  p('311001', 'رأس المال', 'Capital', 'bs.share_capital'),
  h('312', 'الأرباح المحتجزة', 'Retained earnings'),
  p('312001', 'الأرباح المحتجزة', 'Retained earnings', 'bs.retained_earnings', {
    role: 'retained_earnings',
  }),
  h('313', 'جاري المالك', "Owner's current account"),
  p('313001', 'جاري المالك', "Owner's current account", 'bs.owner_current'),
  h('4', 'الإيرادات', 'Revenue'),
  h('41', 'إيرادات النشاط', 'Operating revenue'),
  h('411', 'إيرادات الخدمات', 'Service revenue'),
  p('411001', 'إيرادات الخدمات', 'Service revenue', 'is.revenue', { dims: ['client', 'service'] }),
  p('411002', 'إيرادات رسوم إنهاء العقود', 'Contract termination fees', 'is.revenue', {
    dims: ['client'],
  }),
  h('42', 'إيرادات أخرى', 'Other income'),
  h('421', 'أرباح فروق الصرف', 'Exchange gains'),
  p('421001', 'أرباح فروق صرف محققة', 'Realised exchange gains', 'is.fx_differences', {
    role: 'fx_realised_gain',
  }),
  p('421002', 'أرباح فروق صرف غير محققة', 'Unrealised exchange gains', 'is.fx_differences', {
    role: 'fx_unrealised_gain',
  }),
  h('422', 'إيرادات متنوعة', 'Sundry income'),
  p('422001', 'إيرادات أخرى', 'Other income', 'is.other_income'),
  h('5', 'المصاريف', 'Expenses'),
  h('51', 'التكاليف المباشرة', 'Direct costs'),
  h('511', 'تكاليف المشاريع', 'Project costs'),
  p('511001', 'تكاليف المشاريع المباشرة', 'Direct project costs', 'is.direct_costs', {
    dims: ['client', 'contract', 'department'],
  }),
  h('52', 'مصاريف الموظفين', 'Employee costs'),
  h('521', 'الرواتب والأجور', 'Salaries and wages'),
  p('521001', 'رواتب وأجور', 'Salaries and wages', 'is.employee_benefits', {
    dims: ['department'],
  }),
  p('521002', 'مزايا الموظفين الأخرى', 'Other employee benefits', 'is.employee_benefits', {
    dims: ['department'],
  }),
  h('53', 'المصاريف التشغيلية', 'Operating expenses'),
  h('531', 'مصاريف المكتب', 'Office expenses'),
  p('531001', 'الإيجار', 'Rent', 'is.other_expenses'),
  p('531002', 'الكهرباء والمياه والمحروقات', 'Utilities and fuel', 'is.other_expenses'),
  p('531003', 'الاتصالات والإنترنت', 'Telecom and internet', 'is.other_expenses'),
  p('531004', 'اشتراكات البرمجيات', 'Software subscriptions', 'is.other_expenses'),
  p('531005', 'القرطاسية والمستلزمات', 'Stationery and supplies', 'is.other_expenses'),
  p('531006', 'الصيانة والإصلاح', 'Repairs and maintenance', 'is.other_expenses'),
  h('532', 'المصاريف الإدارية', 'Administrative expenses'),
  p('532001', 'الأتعاب المهنية', 'Professional fees', 'is.other_expenses'),
  p('532002', 'الرسوم المصرفية وعمولات التحويل', 'Bank and transfer charges', 'is.other_expenses'),
  p('532003', 'الرسوم والطوابع الحكومية', 'Government fees and stamps', 'is.other_expenses'),
  p('532004', 'تسويق الوكالة', 'Agency marketing', 'is.other_expenses'),
  h('533', 'الاستهلاك', 'Depreciation'),
  p(
    '533001',
    'استهلاك أجهزة الحاسوب ومعدات التصوير',
    'Depreciation — computers and equipment',
    'is.depreciation',
  ),
  p('533002', 'استهلاك الأثاث والمفروشات', 'Depreciation — furniture', 'is.depreciation'),
  h('54', 'مصاريف أخرى', 'Other expenses'),
  h('541', 'خسائر فروق الصرف والتقريب', 'Exchange losses and rounding'),
  p('541001', 'خسائر فروق صرف محققة', 'Realised exchange losses', 'is.fx_differences', {
    role: 'fx_realised_loss',
  }),
  p('541002', 'خسائر فروق صرف غير محققة', 'Unrealised exchange losses', 'is.fx_differences', {
    role: 'fx_unrealised_loss',
  }),
  p('541003', 'فروق تقريب التحويل', 'Conversion rounding differences', 'is.fx_differences', {
    role: 'conversion_rounding',
  }),
  h('55', 'ضريبة الدخل', 'Income tax'),
  h('551', 'مصروف ضريبة الدخل', 'Income tax expense'),
  p('551001', 'مصروف ضريبة الدخل', 'Income tax expense', 'is.income_tax'),
];

/**
 * `general@1`: the service-agency chart without the agency's accounts (e-wallets, contract assets,
 * ad platforms, client money, termination fees, project costs), with general equipment names,
 * trade payables, revenue and cost of sales and services, and no account requiring contract,
 * department or service (S02 "General").
 */
function generalAccounts(): readonly TemplateAccount[] {
  const removed = new Set([
    '111005',
    '111006',
    '113',
    '113001',
    '211001',
    '211002',
    '213',
    '213001',
    '411002',
    '511',
    '511001',
  ]);
  const changed: Readonly<Record<string, Partial<TemplateAccount>>> = {
    '121001': { name: 'أجهزة ومعدات', nameLatin: 'Equipment' },
    '121003': {
      name: 'مجمع استهلاك الأجهزة والمعدات',
      nameLatin: 'Accumulated depreciation — equipment',
    },
    '533001': { name: 'استهلاك الأجهزة والمعدات', nameLatin: 'Depreciation — equipment' },
    '212001': {
      name: 'التزامات العقود (دفعات مقدمة من العملاء)',
      nameLatin: 'Contract liabilities (advances from customers)',
      requiredDimensions: ['client'],
    },
    '411001': {
      name: 'إيرادات المبيعات والخدمات',
      nameLatin: 'Revenue from sales and services',
      requiredDimensions: ['client'],
    },
    '521001': { requiredDimensions: [] },
    '521002': { requiredDimensions: [] },
  };
  const added = [
    p('211001', 'ذمم الموردين', 'Trade payables', 'bs.trade_payables', M),
    h('511', 'تكلفة المبيعات والخدمات', 'Cost of sales and services'),
    p('511001', 'تكلفة المبيعات والخدمات', 'Cost of sales and services', 'is.direct_costs'),
  ];
  return [
    ...serviceAgencyAccounts
      .filter((account) => !removed.has(account.code))
      .map((account) => ({ ...account, ...changed[account.code] })),
    ...added,
  ].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

export const CHART_TEMPLATES: readonly ChartTemplate[] = [
  {
    id: 'service-agency',
    version: 1,
    name: 'وكالة خدمات',
    nameLatin: 'Service agency',
    accounts: serviceAgencyAccounts,
  },
  {
    id: 'general',
    version: 1,
    name: 'عام',
    nameLatin: 'General',
    accounts: generalAccounts(),
  },
];

/** The template of an id. */
export function chartTemplate(id: ChartTemplateId): ChartTemplate {
  const template = CHART_TEMPLATES.find((candidate) => candidate.id === id);
  if (template === undefined) throw new RangeError(`Unknown chart template ${id}`);
  return template;
}
