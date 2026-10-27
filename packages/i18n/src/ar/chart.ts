import type {
  AccountClass,
  AccountKind,
  AccountRole,
  ChartTemplateId,
  NormalBalance,
} from '@vertex-mizan/contracts';

/**
 * The chart of accounts (S02): account classes, kinds, normal balances, roles and templates, and
 * the chart export's columns. Terms from `docs/glossary.md`; the screens' text joins with them.
 */
export const chart = {
  title: 'دليل الحسابات',
  classes: {
    asset: 'الأصول',
    liability: 'الخصوم',
    equity: 'حقوق الملكية',
    revenue: 'الإيرادات',
    expense: 'المصاريف',
  } satisfies Record<AccountClass, string>,
  kinds: {
    header: 'حساب رئيسي',
    postable: 'حساب فرعي',
  } satisfies Record<AccountKind, string>,
  normalBalances: {
    debit: 'مدين',
    credit: 'دائن',
  } satisfies Record<NormalBalance, string>,
  roles: {
    conversion_rounding: 'فروق تقريب التحويل',
    fx_realised_gain: 'أرباح فروق الصرف المحققة',
    fx_realised_loss: 'خسائر فروق الصرف المحققة',
    fx_unrealised_gain: 'أرباح فروق الصرف غير المحققة',
    fx_unrealised_loss: 'خسائر فروق الصرف غير المحققة',
    retained_earnings: 'الأرباح المحتجزة',
  } satisfies Record<AccountRole, string>,
  templates: {
    'service-agency': 'وكالة خدمات',
    general: 'عام',
  } satisfies Record<ChartTemplateId, string>,
  /** The columns of the chart export (`GET /api/chart/export`), in order. */
  export: {
    code: 'رمز الحساب',
    name: 'اسم الحساب',
    nameLatin: 'الاسم اللاتيني',
    level: 'المستوى',
    kind: 'النوع',
    class: 'فئة الحساب',
    normalBalance: 'طبيعة الحساب',
    statementLine: 'بند القائمة',
    currency: 'عملة الحساب',
    control: 'حساب مراقبة',
    monetary: 'حساب نقدي',
    requiredDimensions: 'الأبعاد المطلوبة',
    roles: 'دور الحساب',
    blocked: 'حساب موقوف',
    archived: 'مؤرشف',
    yes: 'نعم',
    no: 'لا',
  },
} as const;
