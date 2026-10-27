import type { RateSource, RateType } from '@vertex-mizan/contracts';

/**
 * Exchange rates (S02 rules 14–18): the rate pairs, the append-only rate table with its
 * corrections, the rate in force and the bulletin's publication calendar. Terms from
 * `docs/glossary.md` (زوج العملات، سعر النشرة، تصحيح السعر، تقويم النشرة، يوم عدم نشر).
 */
export const rates = {
  title: 'أسعار الصرف',
  nav: 'أسعار الصرف',
  description:
    'أسعار كل زوج عملات بتاريخ سريانها كما وردت، دون قلب: سعر النشرة من مصرف سوريا المركزي، وسعر السوق.',
  readOnly: 'تعرض الأسعار دون تعديل: تسجيلها وتصحيحها للمالك والمحاسب.',
  recordBulletin: 'تسجيل سعر النشرة',
  recordMarket: 'تسجيل سعر السوق',
  newPair: 'زوج عملات جديد',
  calendarLink: 'تقويم النشرة',
  pair: 'زوج العملات',
  type: 'نوع السعر',
  loadMore: 'عرض المزيد',
  types: {
    bulletin: 'سعر النشرة',
    market: 'سعر السوق',
  } satisfies Record<RateType, string>,
  sources: {
    hub: 'Hub',
    manual: 'يدوي',
    import: 'استيراد',
  } satisfies Record<RateSource, string>,
  empty: {
    title: 'لا أسعار صرف بعد',
    description: 'يُنشأ زوج العملات مع أول سعر يُسجَّل له، أو أضفه بنفسك.',
    rows: 'لا أسعار من هذا النوع لهذا الزوج.',
  },
  table: {
    label: 'أسعار الزوج',
    effectiveOn: 'تاريخ السريان',
    rate: 'السعر',
    source: 'المصدر',
    recordedBy: 'سجّله',
    recordedAt: 'وقت التسجيل',
    status: 'الحالة',
    superseded: 'صُحِّح',
    correction: 'تصحيح',
    reason: 'سبب التصحيح',
  },
  /** One base unit in the quote currency: `1 USD = 120.0000 SYP`. */
  perBase: 'لكل واحد',
  status: {
    title: 'حالة النشرة في آخر 30 يومًا',
    label: 'حالة النشرة لكل يوم',
    recorded: 'مسجّل',
    dayOff: 'يوم عدم نشر',
    holiday: 'عطلة',
    missing: 'ناقص',
    missingCount: 'أيام نشر بلا سعر',
    allRecorded: 'لكل يوم نشر سعره.',
  },
  inForce: {
    title: 'السعر النافذ',
    description:
      'سعر النشرة نافذ في يوم النشر الذي سُجّل له، وتأخذ أيام عدم النشر والعطل آخر نشرة صدرت قبلها.',
    on: 'التاريخ',
    ask: 'اعرض السعر',
    effectiveOn: 'ساري من',
    via: 'سعر تقاطعي عبر',
    missing: 'لا سعر نافذ في هذا التاريخ.',
    missingBulletin: 'لا نشرة مسجّلة ليوم النشر',
  },
  record: {
    bulletinTitle: 'تسجيل سعر النشرة',
    marketTitle: 'تسجيل سعر السوق',
    description: 'السعر كما ورد: كم وحدة من العملة الثانية لكل وحدة من الأولى.',
    base: 'العملة الأساسية',
    quote: 'عملة التسعير',
    effectiveOn: 'تاريخ السريان',
    rate: 'السعر',
    rateHint: 'حتى 12 رقمًا قبل الفاصلة و10 بعدها، بكل المنازل كما وردت.',
    rateInvalid: 'السعر رقم موجب بحد أقصى 12 رقمًا قبل الفاصلة و10 بعدها.',
    correctionTitle: 'لهذا التاريخ سعر مسجّل',
    correctionDescription:
      'تسجيل سعر آخر يصحّح السابق ويحل محله. لا تتغير القيود المرحّلة: ستظهر القيود التي استخدمت السعر السابق لتقرر عكس ما تراه خطأ.',
    reason: 'سبب التصحيح',
    submit: 'تسجيل',
    correct: 'تسجيل التصحيح',
    recorded: 'سُجّل السعر.',
    corrected: 'سُجّل التصحيح، وحلّ محل السعر',
  },
  pairDialog: {
    title: 'زوج عملات جديد',
    description:
      'لكل زوج اتجاه واحد تُسجّل به أسعاره بنوعيها: سعر الدولار بالليرة زوجه الدولار أساسًا والليرة تسعيرًا.',
    submit: 'إضافة الزوج',
  },
  validation: {
    required: 'هذا الحقل مطلوب.',
    samePair: 'اختر عملتين مختلفتين.',
    reason: 'اكتب سبب التصحيح، حتى 500 حرف.',
  },
  calendar: {
    title: 'تقويم النشرة',
    nav: 'تقويم النشرة',
    description:
      'الأيام التي لا تصدر فيها نشرة مصرف سوريا المركزي. يأخذ يوم عدم النشر والعطلة آخر نشرة صدرت قبله.',
    daysOff: 'أيام عدم النشر الأسبوعية',
    daysOffHint:
      'الجمعة والسبت افتراضيًا، ولم يُتحقق منهما بعد كأيام نشر المصرف المركزي (UNVERIFIED). يبقى يوم نشر واحد على الأقل.',
    daysOffInvalid: 'يبقى يوم نشر واحد في الأسبوع على الأقل.',
    save: 'حفظ الأيام',
    saved: 'حُفظت أيام عدم النشر.',
    effect: 'يسري التغيير على القيود بعده، ولا يغيّر قيدًا مرحّلًا.',
    holidays: 'العطل',
    holidaysLabel: 'عطل النشرة',
    holidayOn: 'التاريخ',
    note: 'الملاحظة',
    add: 'إضافة العطلة',
    added: 'أُضيفت العطلة.',
    remove: 'إزالة',
    removeTitle: 'إزالة العطلة',
    removeDescription: 'يصبح اليوم يوم نشر يحتاج نشرته.',
    emptyHolidays: 'لا عطل مسجّلة.',
  },
  /** ISO weekdays 1 Monday … 7 Sunday. */
  weekdays: {
    1: 'الاثنين',
    2: 'الثلاثاء',
    3: 'الأربعاء',
    4: 'الخميس',
    5: 'الجمعة',
    6: 'السبت',
    7: 'الأحد',
  } satisfies Record<1 | 2 | 3 | 4 | 5 | 6 | 7, string>,
};
