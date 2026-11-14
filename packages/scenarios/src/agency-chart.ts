import {
  type AccountRole,
  accountClassOfCode,
  type BuiltinDimensionType,
  type CurrencyCode,
  chartTemplate,
  defaultNormalBalance,
  type ItemKind,
  type NormalBalance,
  type TemplateAccount,
} from '@vertex-mizan/contracts';

// The scenario book's chart (ADR 0021): `service-agency@3` as contracts held it before the removal
// of Hub, frozen here because the book's approved cases name its accounts (e-wallets, contract
// assets, client ad funds). The product no longer offers it; a case names it `service-agency`, and
// the book applies it through `packages/db`'s `applyChart()`. Never changed: a change of a case's
// chart is a change of its approved expected values.

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
 * `service-agency@3` (Vertex Media, a sole proprietorship): S02 "Service agency", with S10's
 * `312002` (version 2) and the review's E1, E2 and A1–A14 (version 3).
 */
export const SERVICE_AGENCY_ACCOUNTS: readonly TemplateAccount[] = [
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
  h('113', 'أصول العقود', 'Contract assets'),
  p('113001', 'أصول العقود', 'Contract assets', 'bs.contract_assets', {
    ...M,
    control: 'document',
    dims: ['client', 'contract'],
  }),
  h('114', 'أصول متداولة أخرى', 'Other current assets'),
  p('114001', 'مصاريف مدفوعة مقدمًا', 'Prepaid expenses', 'bs.other_current_assets'),
  // Non-monetary: goods or services to receive (IAS 21.16).
  p('114002', 'دفعات مقدمة للموردين', 'Advances to suppliers', 'bs.other_current_assets'),
  p('114003', 'تأمينات مستردة', 'Refundable deposits', 'bs.other_current_assets', M),
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
  h('122', 'الأصول غير الملموسة', 'Intangible assets'),
  p('122001', 'البرمجيات والمواقع الإلكترونية', 'Software and websites', 'bs.intangible_assets'),
  p('122002', 'مجمع الإطفاء', 'Accumulated amortisation', 'bs.intangible_assets', {
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
  // The obligation REPORTED (Decree 92/1959 as amended by Law 78/2001); rates and ceilings
  // UNVERIFIED.
  p(
    '211004',
    'اشتراكات التأمينات الاجتماعية المستحقة',
    'Social insurance contributions payable',
    'bs.trade_payables',
    M,
  ),
  // IFRS 15.55: a cancelled project's refund (`cancelled_project_refund`).
  p('211005', 'مبالغ مستردة مستحقة للعملاء', 'Refund liabilities to clients', 'bs.trade_payables', {
    ...M,
    dims: ['client'],
  }),
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
    control: 'running',
    currency: 'USD',
    dims: ['client'],
  }),
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
  // Income Tax Law 24/2003 art. 61(b): CONFIRMED on the 2003 text; later amendments and its reach
  // to online ad platforms UNVERIFIED.
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
  p(
    '521003',
    'حصة صاحب العمل من التأمينات الاجتماعية',
    "Employer's social insurance contributions",
    'is.employee_benefits',
    { dims: ['department'] },
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
  p(
    '533001',
    'استهلاك أجهزة الحاسوب ومعدات التصوير',
    'Depreciation — computers and equipment',
    'is.depreciation',
  ),
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

/** The book's charts by id: contracts' templates, and the frozen service-agency chart. */
export const BOOK_CHART_IDS = ['service-agency', 'general'] as const;

export type BookChartId = (typeof BOOK_CHART_IDS)[number];

export const SERVICE_AGENCY_CHART = {
  id: 'service-agency',
  version: 3,
  accounts: SERVICE_AGENCY_ACCOUNTS,
} as const;

/** The chart a case names (`company.template`), or undefined for an unknown one. */
export function bookChart(
  id: string | null | undefined,
):
  | { readonly id: string; readonly version: number; readonly accounts: readonly TemplateAccount[] }
  | undefined {
  if (id === 'service-agency') return SERVICE_AGENCY_CHART;
  if (id === 'general') return chartTemplate('general');
  return undefined;
}
