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
import type { ItemKind } from './open-items.js';

/**
 * The chart templates of S02 ("Templates"), at version 3 after their review
 * (`docs/audits/2026-11-13-chart-templates-review.md`, approved by the owner instead of Syrian
 * accountants, Q3); any change is a new version. Applied at company creation or to a chart that
 * holds the five roots alone. Accounts are in code order, so each parent comes before its children.
 * They hold accounts only: no posting rule depends on the Syrian points the review leaves
 * UNVERIFIED. The service-agency template was removed with Hub (ADR 0021); a contracting template
 * comes with its own spec.
 */

export interface TemplateAccount {
  readonly code: string;
  readonly name: string;
  readonly nameLatin: string;
  readonly kind: AccountKind;
  readonly normalBalance: NormalBalance;
  readonly isMonetary: boolean;
  readonly isControl: boolean;
  /** The kind of a control account's open items (S04, ADR 0013); null on any other account. */
  readonly itemKind: ItemKind | null;
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
  itemKind: null,
  currency: null,
  requiredDimensions: [],
  statementLine: null,
  role: null,
});

interface PostableOptions {
  readonly balance?: NormalBalance;
  readonly monetary?: boolean;
  /** A control account, with the kind of its open items (S04). */
  readonly control?: ItemKind;
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
  isControl: options.control !== undefined,
  itemKind: options.control ?? null,
  currency: options.currency ?? null,
  requiredDimensions: options.dims ?? [],
  statementLine,
  role: options.role ?? null,
});

const M = { monetary: true } as const;

/**
 * `general@3`: S02 "General", with S10's `312002` (version 2) and the review's E1, E2, A1–A16
 * (version 3): general equipment names, trade payables, revenue and cost of sales and services, no
 * account requiring contract, department or service, and, for a company with legal personality,
 * the partners' current accounts as a monetary liability (IAS 32.11, 32.16) and the legal reserve.
 */
const generalAccounts: readonly TemplateAccount[] = [
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
  h('112', 'الذمم المدينة', 'Receivables'),
  p('112001', 'ذمم العملاء التجارية', 'Trade receivables', 'bs.trade_receivables', {
    ...M,
    control: 'document',
    dims: ['client'],
  }),
  p('112002', 'ذمم مدينة أخرى', 'Other receivables', 'bs.trade_receivables', M),
  p('112003', 'سلف الموظفين', 'Employee advances', 'bs.trade_receivables', M),
  // IFRS 9.5.5.15, the simplified approach (IFRS 15.107).
  p(
    '112009',
    'مخصص الخسائر الائتمانية المتوقعة',
    'Allowance for expected credit losses',
    'bs.trade_receivables',
    { ...M, balance: 'credit', dims: ['client'] },
  ),
  h('114', 'أصول متداولة أخرى', 'Other current assets'),
  p('114001', 'مصاريف مدفوعة مقدمًا', 'Prepaid expenses', 'bs.other_current_assets'),
  // Non-monetary: goods or services to receive (IAS 21.16).
  p('114002', 'دفعات مقدمة للموردين', 'Advances to suppliers', 'bs.other_current_assets'),
  p('114003', 'تأمينات مستردة', 'Refundable deposits', 'bs.other_current_assets', M),
  h('12', 'الأصول غير المتداولة', 'Non-current assets'),
  h('121', 'الممتلكات والمعدات', 'Property and equipment'),
  p('121001', 'أجهزة ومعدات', 'Equipment', 'bs.ppe'),
  p('121002', 'الأثاث والمفروشات', 'Furniture and fittings', 'bs.ppe'),
  p('121003', 'مجمع استهلاك الأجهزة والمعدات', 'Accumulated depreciation — equipment', 'bs.ppe', {
    balance: 'credit',
  }),
  p('121004', 'مجمع استهلاك الأثاث والمفروشات', 'Accumulated depreciation — furniture', 'bs.ppe', {
    balance: 'credit',
  }),
  h('122', 'الأصول غير الملموسة', 'Intangible assets'),
  p('122001', 'البرمجيات والمواقع الإلكترونية', 'Software and websites', 'bs.intangible_assets'),
  p('122002', 'مجمع الإطفاء', 'Accumulated amortisation', 'bs.intangible_assets', {
    balance: 'credit',
  }),
  h('2', 'الخصوم', 'Liabilities'),
  h('21', 'الخصوم المتداولة', 'Current liabilities'),
  h('211', 'الذمم الدائنة', 'Payables'),
  p('211001', 'ذمم الموردين', 'Trade payables', 'bs.trade_payables', M),
  p('211003', 'ذمم دائنة أخرى', 'Other payables', 'bs.trade_payables', M),
  // The obligation REPORTED (Decree 92/1959 as amended by Law 78/2001); rates and ceilings
  // UNVERIFIED.
  p(
    '211004',
    'اشتراكات التأمينات الاجتماعية المستحقة',
    'Social insurance contributions payable',
    'bs.trade_payables',
    M,
  ),
  // IFRS 15.55: refunds owed to clients.
  p('211005', 'مبالغ مستردة مستحقة للعملاء', 'Refund liabilities to clients', 'bs.trade_payables', {
    ...M,
    dims: ['client'],
  }),
  h('212', 'التزامات العقود', 'Contract liabilities'),
  p(
    '212001',
    'التزامات العقود (دفعات مقدمة من العملاء)',
    'Contract liabilities (advances from customers)',
    'bs.contract_liabilities',
    { dims: ['client'] },
  ),
  h('214', 'الضرائب والرسوم المستحقة', 'Taxes and fees payable'),
  p('214001', 'ضريبة الدخل المستحقة', 'Income tax payable', 'bs.tax_liabilities', M),
  // Not the entity's income taxes (IAS 12), so not on `bs.tax_liabilities` (E1). Their Syrian
  // rules stay UNVERIFIED (S02 and the review); the names carry no mark (E2).
  p(
    '214002',
    'رسم الإنفاق الاستهلاكي المستحق',
    'Consumption expenditure fee payable',
    'bs.other_taxes_payable',
    M,
  ),
  p('214003', 'رسم الطابع المستحق', 'Stamp duty payable', 'bs.other_taxes_payable', M),
  p(
    '214004',
    'ضريبة الرواتب والأجور المقتطعة',
    'Payroll tax withheld',
    'bs.other_taxes_payable',
    M,
  ),
  // Income Tax Law 24/2003 art. 61(b): CONFIRMED on the 2003 text; later amendments UNVERIFIED.
  p(
    '214005',
    'ضريبة غير المقيمين المقتطعة',
    'Non-resident tax withheld',
    'bs.other_taxes_payable',
    M,
  ),
  h('215', 'المصاريف المستحقة', 'Accrued expenses'),
  p('215001', 'رواتب وأجور مستحقة', 'Accrued salaries and wages', 'bs.accruals', M),
  p('215002', 'مصاريف مستحقة أخرى', 'Other accrued expenses', 'bs.accruals', M),
  h('216', 'القروض والسلف قصيرة الأجل', 'Short-term borrowings'),
  p('216001', 'القروض والسلف قصيرة الأجل', 'Short-term borrowings', 'bs.borrowings', M),
  h('217', 'جاري الشركاء', "Partners' current accounts"),
  p('217001', 'جاري الشركاء', "Partners' current accounts", 'bs.trade_payables', M),
  h('3', 'حقوق الملكية', 'Equity'),
  h('31', 'رأس المال والاحتياطيات', 'Capital and reserves'),
  h('311', 'رأس المال', 'Capital'),
  p('311001', 'رأس المال', 'Capital', 'bs.share_capital'),
  h('312', 'الأرباح المحتجزة', 'Retained earnings'),
  p('312001', 'الأرباح المحتجزة', 'Retained earnings', 'bs.retained_earnings', {
    role: 'retained_earnings',
  }),
  // S10 (ADR 0019): the books start's fiscal year's result before the books start (version 2).
  p(
    '312002',
    'نتيجة السنة قبل بدء الدفاتر',
    'Result of the year before the books start',
    'bs.retained_earnings',
    { role: 'pre_opening_result' },
  ),
  h('313', 'جاري المالك', "Owner's current account"),
  p('313001', 'جاري المالك', "Owner's current account", 'bs.owner_current'),
  h('314', 'الاحتياطيات', 'Reserves'),
  // The Companies Law 29/2011 rule (10% of profit until 25% of capital) is UNVERIFIED.
  p('314001', 'الاحتياطي القانوني', 'Legal reserve', 'bs.reserves'),
  h('4', 'الإيرادات', 'Revenue'),
  h('41', 'إيرادات النشاط', 'Operating revenue'),
  h('411', 'إيرادات الخدمات', 'Service revenue'),
  p('411001', 'إيرادات المبيعات والخدمات', 'Revenue from sales and services', 'is.revenue', {
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
  h('511', 'تكلفة المبيعات والخدمات', 'Cost of sales and services'),
  p('511001', 'تكلفة المبيعات والخدمات', 'Cost of sales and services', 'is.direct_costs'),
  h('52', 'مصاريف الموظفين', 'Employee costs'),
  h('521', 'الرواتب والأجور', 'Salaries and wages'),
  p('521001', 'رواتب وأجور', 'Salaries and wages', 'is.employee_benefits'),
  p('521002', 'مزايا الموظفين الأخرى', 'Other employee benefits', 'is.employee_benefits'),
  p(
    '521003',
    'حصة صاحب العمل من التأمينات الاجتماعية',
    "Employer's social insurance contributions",
    'is.employee_benefits',
  ),
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
  // Borne instead of withheld: not IAS 12 income tax. UNVERIFIED as `214005`.
  p('532005', 'ضريبة غير المقيمين المتحمَّلة', 'Non-resident tax borne', 'is.other_expenses'),
  p(
    '532006',
    'خسائر انخفاض قيمة الذمم المدينة وأصول العقود',
    'Impairment losses on receivables and contract assets',
    'is.impairment_losses',
  ),
  h('533', 'الاستهلاك والإطفاء', 'Depreciation and amortisation'),
  p('533001', 'استهلاك الأجهزة والمعدات', 'Depreciation — equipment', 'is.depreciation'),
  p('533002', 'استهلاك الأثاث والمفروشات', 'Depreciation — furniture', 'is.depreciation'),
  p('533003', 'إطفاء الأصول غير الملموسة', 'Amortisation of intangible assets', 'is.depreciation'),
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
  h('56', 'تكاليف التمويل', 'Finance costs'),
  h('561', 'فوائد القروض والسحب على المكشوف', 'Interest on loans and overdrafts'),
  p(
    '561001',
    'فوائد القروض والسحب على المكشوف',
    'Interest on loans and overdrafts',
    'is.finance_costs',
  ),
];

export const CHART_TEMPLATES: readonly ChartTemplate[] = [
  {
    id: 'general',
    version: 3,
    name: 'عام',
    nameLatin: 'General',
    accounts: generalAccounts,
  },
];

/** The template of an id. */
export function chartTemplate(id: ChartTemplateId): ChartTemplate {
  const template = CHART_TEMPLATES.find((candidate) => candidate.id === id);
  if (template === undefined) throw new RangeError(`Unknown chart template ${id}`);
  return template;
}
