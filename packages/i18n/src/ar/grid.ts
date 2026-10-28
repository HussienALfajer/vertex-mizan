/** The data grid's text (ADR 0010 §4); terms from `docs/glossary.md`. */
export const grid = {
  /** The selection summary bar. */
  summary: {
    label: 'ملخص التحديد',
    count: 'العدد',
    sum: 'المجموع',
    average: 'المتوسط',
    minimum: 'الأدنى',
    maximum: 'الأعلى',
    kinds: {
      transaction: 'مبلغ المعاملة',
      book: 'مبلغ الدفاتر',
      parallel: 'المبلغ الموازي',
    },
  },
  /** Why a paste, a fill down, a clear or an edit changed nothing (the grid core's problems). */
  problems: {
    nothingChanged: 'لم يتغير شيء.',
    EMPTY: 'لا يوجد في الحافظة ما يُلصق.',
    NOT_RECTANGULAR: 'لا يمكن لصق النص: صفوفه مختلفة الطول.',
    DOES_NOT_FIT: 'ما نُسخ أكبر من المساحة المتاحة في الجدول.',
    NOTHING_TO_FILL: 'لا يوجد صف فوق التحديد للتعبئة منه.',
    READ_ONLY: 'هذه الخلية لا تقبل التعديل.',
    CURRENCY_MISMATCH: 'لا يُنسخ مبلغ إلى سطر بعملة أخرى.',
    NOTHING_TO_BALANCE: 'لا يوجد فرق يوازنه هذا الحقل.',
  },
};
