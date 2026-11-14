import type {
  OPENING_EXPORT_PARTS,
  OPENING_LINE_SOURCES,
  OpeningCheck,
  OpeningState,
} from '@vertex-mizan/contracts';

/**
 * The opening balances (S10 "Screens", "Arabic strings", without Hub: ADR 0021): `/opening` in its
 * two steps, its states, the line sources, the checks and what fails them, the dialogs, and the
 * Excel of the preview. Terms from `docs/glossary.md` (الأرصدة الافتتاحية، تاريخ بدء الدفاتر، قيد
 * الأرصدة الافتتاحية، لقطة Hub الافتتاحية، الرقم الموازن، مبلغ منقول).
 */
export const opening = {
  nav: 'الأرصدة الافتتاحية',
  title: 'الأرصدة الافتتاحية',
  description: 'قيد واحد في تاريخ بدء الدفاتر: أرصدة الميزانية من السجلات القديمة.',
  states: {
    draft: 'مسودة',
    posted: 'مرحّل',
    reversed: 'معكوس',
  } satisfies Record<OpeningState, string>,
  notStarted: 'لم تُحفظ بعد',
  facts: {
    state: 'الحالة',
    booksStart: 'تاريخ بدء الدفاتر',
    asOf: 'الأرصدة كما في',
    version: 'نسخة المسودة',
  },
  noBooksStart: {
    title: 'حدّد تاريخ بدء الدفاتر في إعدادات الشركة',
    description: 'تُعدّ الأرصدة الافتتاحية بعد تحديد أول يوم تحفظه الدفاتر في ميزان.',
    action: 'إعدادات الشركة',
  },
  steps: {
    label: 'خطوات الأرصدة الافتتاحية',
    records: 'أرصدة السجلات',
    review: 'المراجعة والترحيل',
    status: {
      done: 'مكتملة',
      attention: 'تحتاج إلى معالجة',
      pending: 'لم تكتمل بعد',
    },
  },
  records: {
    description:
      'رصيد لكل حساب من السجلات القديمة. الحسابات النقدية تُقاس بأسعار العشية فتظهر محسوبة، وغيرها يُنقل بمبلغيه في الدفترين.',
    yearResult:
      'نتيجة السنة من بدايتها حتى العشية سطر على حساب «نتيجة السنة قبل بدء الدفاتر»، ولو كانت صفراً.',
    grid: 'أسطر السجلات',
    lineNumber: 'م',
    account: 'الحساب',
    currency: 'العملة',
    debit: 'مدين',
    credit: 'دائن',
    book: 'الدفتر الأساسي',
    parallel: 'الدفتر الموازي',
    measure: 'القياس',
    reference: 'مرجع البند',
    dueOn: 'تاريخ الاستحقاق',
    memo: 'البيان',
    computed: 'محسوب',
    stated: 'منقول',
    computedAt: 'بسعر {rate} في {date}',
    computedOnSave: 'يُحسب عند الحفظ',
    addLine: 'سطر جديد',
    removeLine: 'احذف السطر {no}',
    empty: 'لا أسطر من السجلات بعد.',
    accountUnknown: 'لا حساب بهذا الرمز',
    valueUnknown: 'لا قيمة بهذا الرمز أو الاسم',
    currencyUnknown: 'عملة غير معروفة',
    dateInvalid: 'تاريخ بصيغة YYYY-MM-DD',
    referenceLength: 'المرجع 100 حرف على الأكثر',
    memoLength: 'البيان 300 حرف على الأكثر',
    readOnly: 'المسودة للقراءة فقط.',
  },
  review: {
    description:
      'القيد كما سيُرحَّل الآن، والرقم الموازن على الأرباح المحتجزة في كل دفتر، والفحوص التي يجب أن تنجح كلها.',
    checks: 'الفحوص',
    summary: '{passed} من {total} ناجحة',
    passed: 'ناجح',
    failed: 'غير ناجح',
    failures: '{count} مشكلة',
    checkNames: {
      rates: 'الأسعار مسجلة',
      mappings: 'الحسابات والقيم مربوطة',
      lines: 'أسطر السجلات صحيحة',
    } satisfies Record<OpeningCheck, string>,
    links: {
      rates: 'سجّل الأسعار',
      roles: 'أدوار الحسابات',
      records: 'أسطر السجلات',
    },
    failure: {
      rate: '{ledger}: سعر {from} إلى {to} في {on}',
      roleMissing: 'لا حساب لدور «{role}»',
      roleBlocked: 'الحساب {account} لدور «{role}» موقوف أو مؤرشف',
      line: 'السطر {no}: {reason}',
      other: 'مشكلة غير معروفة',
      lineReasons: {
        NOT_FOUND: 'الحساب غير موجود',
        STATED_AMOUNT_MISSING: 'ينقصه مبلغ {ledger}',
        income_statement_account: 'لا رصيد افتتاحي على حساب إيراد أو مصروف',
      } as Record<string, string>,
    },
    preview: 'معاينة القيد',
    previewEmpty: 'تظهر معاينة القيد بعد نجاح الفحوص التي تسبق الأسطر.',
    sources: {
      records: 'من السجلات',
      balancing: 'الرقم الموازن',
    } satisfies Record<(typeof OPENING_LINE_SOURCES)[number], string>,
    groups: {
      records: 'أرصدة السجلات',
      balancing: 'الرقم الموازن',
    },
    groupCount: '{count} سطر',
    columns: {
      lineNo: 'م',
      account: 'الحساب',
      dimensions: 'الأبعاد',
      reference: 'المرجع',
      kind: 'القياس',
      currency: 'العملة',
      amount: 'المبلغ',
      book: 'الدفتر الأساسي',
      parallel: 'الدفتر الموازي',
    },
    balancing: 'الرقم الموازن على الأرباح المحتجزة',
    balancingNone: 'لا رقم موازن: القيد متوازن في الدفترين.',
    kinds: { measured: 'محسوب', stated: 'منقول' } as Record<string, string>,
  },
  actions: {
    save: 'احفظ المسودة',
    saved: 'حُفظت المسودة.',
    unsaved: 'تغييرات لم تُحفظ: احفظها قبل الترحيل.',
    fixBeforeSaving: 'صحّح الخلايا المرفوضة قبل الحفظ.',
    post: 'رحّل قيد الأرصدة الافتتاحية',
    postDisabled: 'لا يُرحّل القيد قبل نجاح كل الفحوص.',
    postOwnerOnly: 'يرحّل المالك القيد بعد المراجعة.',
    changed: 'تغيّرت الأرصدة الافتتاحية منذ قراءتها، فقُرئت من جديد: راجعها ثم أعد المحاولة.',
    reverse: 'اعكس القيد كاملاً',
    exportPreview: 'Excel المعاينة',
  },
  postDialog: {
    title: 'ترحيل قيد الأرصدة الافتتاحية',
    description: 'يُرحَّل القيد في تاريخ بدء الدفاتر قيداً أول في السنة المالية. يُطلب رمز المصادقة.',
    submit: 'رحّل',
  },
  reverseDialog: {
    title: 'عكس قيد الأرصدة الافتتاحية',
    description:
      'يُعكس القيد كاملاً ما دام القيد الوحيد في الشركة، وتبدأ مسودة جديدة من نسخة منه. يُطلب السبب ورمز المصادقة.',
    reason: 'السبب',
    submit: 'اعكس',
  },
  posted: {
    title: 'رُحّل قيد الأرصدة الافتتاحية',
    description: 'القيد {number} بتاريخ {date}، رُحّل في {at}.',
    entry: 'افتح القيد',
  },
  reversed: {
    title: 'عُكس قيد سابق للأرصدة الافتتاحية',
    description: 'القيد {number} عُكس بالقيد {reversal} في {at}. السبب: {reason}',
    newDraft: 'المسودة الحالية تبدأ من نسخة من أسطره وأرقامه.',
  },
  /** The workbook of `GET /api/opening/export` (S10 "Screens", Export). */
  export: {
    sheets: {
      preview: 'معاينة القيد',
    } satisfies Record<(typeof OPENING_EXPORT_PARTS)[number], string>,
    booksStart: 'تاريخ بدء الدفاتر',
    asOf: 'الأرصدة كما في',
    state: 'الحالة',
    previewEmpty: 'لا معاينة ما دامت هذه الفحوص غير ناجحة:',
  },
  /** On `/entries/:id` (S10 "Screens"). */
  entry: {
    badge: 'قيد افتتاحي',
    link: 'الأرصدة الافتتاحية',
    description: 'قيد الأرصدة الافتتاحية من السجلات القديمة.',
  },
  /** `/settings/company` (S10 rules 1–2). */
  booksStart: {
    title: 'تاريخ بدء الدفاتر',
    description:
      'أول يوم تحفظه الدفاتر في ميزان، أول يوم في شهر. الأشهر قبله مقفلة، وقيد الأرصدة الافتتاحية يؤرَّخ به.',
    label: 'تاريخ بدء الدفاتر',
    hint: 'اختر الشهر الذي تبدأ به الدفاتر، من 2026-01 فما بعد: يُحفظ أول يوم فيه.',
    none: 'لم يُحدَّد: تبدأ الشركة بلا أرصدة افتتاحية.',
    invalid: 'اختر شهرًا من 2026-01 فما بعد.',
    required: 'لا يُمحى تاريخ بدء الدفاتر بعد تحديده.',
    submit: 'احفظ تاريخ بدء الدفاتر',
    saved: 'حُفظ تاريخ بدء الدفاتر.',
    lockedTitle: 'تاريخ بدء الدفاتر مقفل',
    locked: {
      posted: 'رُحّل قيد في الشركة.',
      opening: 'بدأت مسودة الأرصدة الافتتاحية.',
      general: 'لا يتغيّر بعد ترحيل قيد أو بدء المسودة، ولا يُمحى بعد تحديده.',
    },
    openOpening: 'افتح الأرصدة الافتتاحية',
  },
} as const;
