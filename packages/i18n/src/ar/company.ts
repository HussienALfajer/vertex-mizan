import type { RateType } from '@vertex-mizan/contracts';

/**
 * Companies: the list, a new company, the company's settings, the switcher and the archived
 * banner (S01). Terms from `docs/glossary.md`; error codes keep their text in `errors`.
 */
export const company = {
  nav: {
    companies: 'الشركات',
    settings: 'إعدادات الشركة',
  },
  switcher: {
    label: 'الشركة النشطة',
    none: 'اختر شركة',
    open: 'بدّل الشركة',
    all: 'كل الشركات',
    archived: 'مؤرشفة',
  },
  archivedBanner: {
    title: 'هذه الشركة مؤرشفة',
    description: 'يمكنك القراءة والتصدير فقط. لا يُحفظ أي تغيير حتى يستعيدها مالك الشركة.',
  },
  list: {
    title: 'الشركات',
    description: 'الشركات التي أنت عضو فيها. يعمل كل طلب في الشركة النشطة وحدها.',
    create: 'شركة جديدة',
    open: 'افتح',
    active: 'النشطة',
    archived: 'مؤرشفة',
    emptyTitle: 'أنشئ شركتك الأولى',
    emptyDescription: 'لست عضوًا في أي شركة بعد. أنشئ شركة لتصبح مالكها، أو اقبل دعوة وصلتك.',
    role: 'دورك',
  },
  fields: {
    name: 'اسم الشركة',
    nameLatin: 'الاسم اللاتيني',
    nameLatinHint: 'اختياري، كما يظهر في المراسلات الأجنبية.',
    bookLedger: 'الدفاتر',
    bookLedgerHint: 'الدفاتر النظامية للشركة، بعملة الدفاتر.',
    parallelLedger: 'الدفتر الموازي',
    parallelLedgerHint: 'دفتر كامل ثانٍ بعملة أخرى، له فروق صرفه وإعادة تقييمه الخاصة.',
    hasParallel: 'للشركة دفتر موازٍ',
    currency: 'العملة',
    rateType: 'نوع السعر',
    acceptsTransactionRate: 'يقبل سعر العملية',
    acceptsTransactionRateHint:
      'يقبل السعر الذي تمت به العملية في النظام المصدر. للسعر السوقي فقط.',
    fiscalYearStart: 'بداية السنة المالية',
    fiscalYearStartHint: 'كانون الثاني افتراضيًا: السنة الضريبية في سوريا سنة ميلادية.',
    template: 'قالب دليل الحسابات',
    policyNote: 'مذكرة السياسة',
    policyNoteHint:
      'أساس اختيار العملة الوظيفية وفق المعيار المحاسبي الدولي 21 (الفقرات 9–12)، بكلمات الشركة.',
  },
  rateTypes: {
    market: 'سعر السوق',
    bulletin: 'سعر النشرة',
  } satisfies Record<RateType, string>,
  validation: {
    required: 'هذا الحقل مطلوب.',
    nameLength: 'الاسم حتى 200 حرف.',
    policyNoteLength: 'المذكرة حتى 4000 حرف.',
    sameCurrency: 'العملة الموازية تختلف عن عملة الدفاتر.',
    reasonLength: 'السبب حتى 1000 حرف.',
  },
  create: {
    title: 'شركة جديدة',
    description: 'تصبح مالك الشركة. تبقى إعدادات الدفاتر قابلة للتعديل حتى ترحيل أول قيد.',
    submit: 'أنشئ الشركة',
    created: 'أُنشئت الشركة. افتحها للمتابعة.',
    open: 'افتح الشركة',
  },
  settings: {
    title: 'إعدادات الشركة',
    description: 'الملف التعريفي، والدفاتر وسياسات أسعارها، وبداية السنة المالية، ومذكرة السياسة.',
    readOnly: 'تقرأ الإعدادات فقط. يعدّلها مالك الشركة.',
    profile: {
      title: 'الملف التعريفي',
      submit: 'احفظ الملف',
      saved: 'حُفظ الملف التعريفي.',
    },
    ledgers: {
      title: 'إعدادات الدفاتر',
      description: 'العملات وسياسة السعر لكل دفتر وبداية السنة المالية. يطلب الحفظ رمز المصادقة.',
      submit: 'احفظ إعدادات الدفاتر',
      saved: 'حُفظت إعدادات الدفاتر.',
      lockedTitle: 'إعدادات الدفاتر مقفلة',
      lockedDescription:
        'رُحّل أول قيد في الشركة، فلا تتغير العملات وسياسات الأسعار وبداية السنة المالية بعده (المعيار المحاسبي الدولي 21، الفقرات 35–37). تبقى مذكرة السياسة قابلة للتعديل.',
      none: 'لا يوجد',
    },
    policyNote: {
      title: 'مذكرة السياسة',
      description: 'تبقى قابلة للتعديل دائمًا، ويُسجَّل كل تعديل في سجل التدقيق.',
      submit: 'احفظ المذكرة',
      saved: 'حُفظت مذكرة السياسة.',
    },
    approval: {
      title: 'اعتماد القيود اليدوية',
      description:
        'عند تفعيله تُرسل القيود اليدوية والقيود العكسية للاعتماد قبل ترحيلها، ولا يعتمد القيد من أعدّه أو أرسله.',
      label: 'اعتماد القيود اليدوية',
      on: 'مفعّل: يعتمد المالك أو المعتمد كل قيد يدوي قبل ترحيله.',
      off: 'غير مفعّل: يرحّل المالك والمحاسب القيود اليدوية مباشرة.',
    },
    archive: {
      title: 'أرشفة الشركة',
      description:
        'تصبح الشركة للقراءة فقط: يُرفض كل تغيير وتُلغى الدعوات المعلّقة. لا تُحذف الشركات أبدًا.',
      action: 'أرشف الشركة',
      confirm: 'أرشف',
      reason: 'سبب الأرشفة',
      archivedAt: 'أُرشفت في',
      archivedReason: 'السبب',
    },
    restore: {
      title: 'استعادة الشركة',
      description: 'تعود الشركة قابلة للتعديل. تبقى الدعوات الملغاة ملغاة.',
      action: 'استعد الشركة',
      confirm: 'استعد',
      reason: 'سبب الاستعادة',
    },
    membership: {
      title: 'عضويتك',
      description: 'دورك في هذه الشركة. يمكنك مغادرتها ما دام فيها مالك آخر.',
      leave: 'غادر الشركة',
    },
  },
};
