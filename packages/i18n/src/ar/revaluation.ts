import type { RevaluationState } from '@vertex-mizan/contracts';

/**
 * The month-end revaluation (S07 "Screens", "Arabic strings", IAS 21.23): a ledger's preview of a
 * month with its closing rates, balances and totals, the posted revaluations and their reversals,
 * and the posting. Terms from `docs/glossary.md` (إعادة التقييم، سعر الإقفال، المبلغ الدفتري،
 * أرباح غير محققة، خسائر غير محققة، قيد تسوية).
 */
export const revaluation = {
  nav: 'إعادة التقييم',
  title: 'إعادة التقييم',
  description:
    'إعادة تقييم الأرصدة النقدية بغير عملة الدفتر بسعر الإقفال في آخر يوم من الشهر، تُعكس في أول يوم من الشهر التالي.',
  month: 'الشهر',
  ledgers: {
    label: 'الدفتر',
    book: 'الدفتر الأساسي',
    parallel: 'الدفتر الموازي',
  },
  lastDay: 'تاريخ القيد',
  states: {
    current: 'إعادة التقييم حالية',
    to_post: 'فروق بانتظار الترحيل',
    rate_missing: 'سعر إقفال غير مسجل',
  } satisfies Record<RevaluationState, string>,
  currentDescription: 'لا فرق بين القيمة بعد التقييم والمبلغ الدفتري مع ما أُعيد تقييمه.',
  rateMissing: {
    description: 'لا يُرحَّل هذا الدفتر حتى يُسجَّل سعر الإقفال:',
    record: 'سجّل السعر',
  },
  changed: 'تغيّرت الأرقام منذ عرضها، وهذه هي المعاينة الجديدة: راجعها ثم رحّلها.',
  notEnded: 'تُعرض المعاينة الآن، ويُرحَّل القيد بعد انتهاء الشهر بتوقيت دمشق.',
  closed: 'الشهر مقفل، فلا يُعاد تقييمه حتى يُعاد فتحه.',
  openPeriod: 'افتح الفترة',
  closingRates: {
    title: 'سعر الإقفال',
    label: 'أسعار الإقفال',
    currency: 'العملة',
    rateType: 'نوع السعر',
    rate: 'السعر',
    pair: 'الزوج',
    effectiveOn: 'تاريخ السعر',
    cross: 'سعر مركّب',
    none: 'لا أرصدة بعملات أخرى في هذا الدفتر.',
  },
  balances: {
    title: 'الأرصدة',
    label: 'أرصدة إعادة التقييم',
    account: 'الحساب',
    itemOrDimensions: 'البند أو الأبعاد',
    currency: 'العملة',
    transaction: 'الرصيد بعملته',
    carrying: 'المبلغ الدفتري',
    closingRate: 'سعر الإقفال',
    target: 'القيمة بعد التقييم',
    revalued: 'المُعاد تقييمه سابقاً',
    difference: 'الفرق',
    blocked: 'موقوف',
    archived: 'مؤرشف',
    noRate: 'لا سعر',
    empty: 'لا أرصدة لإعادة تقييمها في هذا الشهر.',
    totals: 'المجموع',
  },
  gain: 'أرباح غير محققة',
  loss: 'خسائر غير محققة',
  posted: {
    title: 'إعادات التقييم المرحّلة',
    label: 'إعادات التقييم المرحّلة',
    kind: 'النوع',
    first: 'إعادة تقييم',
    adjusting: 'قيد تسوية',
    entry: 'القيد',
    reversal: 'قيد العكس',
    at: 'وقت الترحيل',
    none: 'لم تُرحَّل إعادة تقييم لهذا الشهر في هذا الدفتر بعد.',
  },
  actions: {
    post: 'ترحيل إعادة التقييم',
    adjust: 'ترحيل قيد تسوية',
    both: 'ترحيل الدفترين',
    done: 'رُحّلت إعادة التقييم مع قيد عكسها في أول يوم من الشهر التالي.',
    nothing: 'لا فروق لترحيلها.',
  },
  entry: {
    month: 'إعادة تقييم الشهر',
    reversal: 'قيد العكس',
    reversed: 'القيد المعكوس',
  },
};
