import type { ContractKind } from '@vertex-mizan/contracts';

/**
 * Dimensions (S02 rules 9–13): types and values, Hub's values and the manual ones linked to a Hub
 * ID. Terms from `docs/glossary.md` (نوع البعد، قيمة البعد، العقد، الربط بـ Hub).
 */
export const dimensions = {
  title: 'الأبعاد',
  nav: 'الأبعاد',
  description:
    'أنواع الأبعاد التي تحملها سطور القيود للتحليل، وقيمها: ما يرسله Hub بمعرّفه، وما تضيفه بنفسك.',
  readOnly: 'تعرض الأبعاد دون تعديل: إضافتها وتعديلها للمالك والمحاسب.',
  types: 'أنواع الأبعاد',
  builtin: 'أساسي',
  showArchived: 'إظهار المؤرشفة',
  archived: 'مؤرشف',
  search: 'بحث بالرمز أو الاسم',
  loadMore: 'عرض المزيد',
  newType: 'نوع بعد جديد',
  newValue: 'قيمة جديدة',
  emptyTypes: 'لا أنواع أبعاد.',
  table: {
    label: 'قيم البعد',
    code: 'الرمز',
    name: 'الاسم',
    nameLatin: 'الاسم اللاتيني',
    kind: 'نوع العقد',
    client: 'العميل',
    hub: 'الربط بـ Hub',
    manual: 'يدوية',
    status: 'الحالة',
    actions: 'الإجراءات',
    menu: 'إجراءات القيمة',
  },
  empty: {
    title: 'لا قيم في هذا النوع بعد',
    description:
      'يضيف Hub قيمه عند أول حدث يذكرها، ويمكنك إضافة قيمة يدوية وربطها بمعرّف Hub لاحقًا.',
    search: 'لا قيمة تطابق البحث.',
  },
  actions: {
    edit: 'تعديل',
    link: 'ربط بـ Hub',
    archive: 'أرشفة',
    restore: 'استعادة',
    editType: 'تعديل النوع',
    archiveType: 'أرشفة النوع',
    restoreType: 'استعادة النوع',
    typeMenu: 'إجراءات النوع',
  },
  value: {
    createTitle: 'قيمة جديدة',
    editTitle: 'تعديل القيمة',
    code: 'الرمز المختصر',
    codeHint: 'اختياري: رمز يبحث به المحاسب.',
    name: 'الاسم',
    nameLatin: 'الاسم اللاتيني',
    kind: 'نوع العقد',
    client: 'العميل',
    clientHint: 'العميل الذي يتبع له العقد.',
    hubTitle: 'قيمة من Hub',
    hubDescription: 'يعيد Hub تسمية هذه القيمة عندما يرسل اسمًا مختلفًا في حدث لاحق.',
    create: 'إضافة القيمة',
    save: 'حفظ',
    saved: 'حُفظت القيمة.',
    nothingChanged: 'لم يتغير شيء.',
  },
  link: {
    title: 'ربط القيمة بـ Hub',
    description:
      'بعد الربط تجد أحداث Hub هذه القيمة بمعرّفها. لا يتغير الربط بعد ذلك، فتحقق من المعرّف قبل الحفظ.',
    externalId: 'معرّف Hub',
    externalIdHint: 'المعرّف كما يظهر في Hub، أو رمز القسم الثابت.',
    submit: 'ربط',
    linked: 'رُبطت القيمة بـ Hub.',
  },
  archive: {
    title: 'أرشفة القيمة',
    description:
      'تختفي القيمة المؤرشفة من قوائم الاختيار وتُرفض في السطور اليدوية، ويبقى Hub قادرًا على ذكرها.',
    submit: 'أرشفة القيمة',
  },
  restore: {
    title: 'استعادة القيمة',
    description: 'تعود القيمة إلى قوائم الاختيار وتُقبل في السطور اليدوية.',
    submit: 'استعادة القيمة',
  },
  type: {
    createTitle: 'نوع بعد جديد',
    editTitle: 'تعديل نوع البعد',
    code: 'رمز النوع',
    codeHint: 'حروف لاتينية صغيرة وأرقام و _، يبدأ بحرف. لا يتغير بعد الإضافة.',
    name: 'الاسم',
    nameLatin: 'الاسم اللاتيني',
    limit: 'حتى 10 أنواع نشطة في الشركة، والأساسية منها.',
    create: 'إضافة النوع',
    save: 'حفظ',
  },
  archiveType: {
    title: 'أرشفة نوع البعد',
    description:
      'يختفي النوع المؤرشف وقيمه من قوائم الاختيار. لا يُؤرشف نوع يطلبه حساب ولا نوع أساسي.',
    submit: 'أرشفة النوع',
  },
  restoreType: {
    title: 'استعادة نوع البعد',
    description: 'يعود النوع وقيمه إلى قوائم الاختيار.',
    submit: 'استعادة النوع',
  },
  validation: {
    required: 'هذا الحقل مطلوب.',
    typeCode: 'حروف لاتينية صغيرة وأرقام و _، من حرفين إلى 40، يبدأ بحرف.',
    length: 'النص أطول من المسموح.',
  },
  picker: {
    placeholder: 'ابحث بالرمز أو الاسم',
    empty: 'لا قيمة تطابق البحث.',
    clear: 'مسح الاختيار',
  },
  contractKinds: {
    project: 'مشروع',
    retainer: 'عقد دوري',
  } satisfies Record<ContractKind, string>,
};
