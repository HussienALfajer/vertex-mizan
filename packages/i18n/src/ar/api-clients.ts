import type { ApiClientScope, ApiClientSystem } from '@vertex-mizan/contracts';

/**
 * The API clients (S05 "Screens", `/settings/api-clients`): the systems that post to the company,
 * their keys, scopes, IP allow-lists and the document types each is the source of.
 */
export const apiClients = {
  nav: 'عملاء الواجهة البرمجية',
  title: 'عملاء الواجهة البرمجية',
  description:
    'الأنظمة التي ترسل أحداثها إلى ميزان بمفتاح، مثل Hub: صلاحيات كل مفتاح، والعناوين المسموح بها، وأنواع المستندات التي يصدرها كل نظام.',
  readOnly: 'تعرض هذه الصفحة العملاء ومفاتيحهم للقراءة فقط: يديرها المالك.',
  systems: { hub: 'Vertex Hub' } satisfies Record<ApiClientSystem, string>,
  scopes: {
    'events:write': 'إرسال الأحداث',
    'periods:read': 'قراءة حالة الفترات',
    'reconciliation:write': 'إرسال المطابقة اليومية',
    'opening:write': 'إرسال لقطة الأرصدة الافتتاحية',
  } satisfies Record<ApiClientScope, string>,
  unknownScope: 'صلاحية غير معروفة',
  empty: 'لا عميل بعد',
  emptyDescription: 'أنشئ عميلًا لـ Hub ليرسل أحداثه بمفتاح يظهر مرة واحدة.',
  archived: 'مؤرشف',
  client: {
    system: 'النظام',
    scopes: 'الصلاحيات',
    allowList: 'العناوين المسموح بها',
    anyAddress: 'أي عنوان',
    documentTypes: 'أنواع المستندات',
    noDocumentTypes: 'لا نوع',
    // S08 rule 13.
    reconcileFrom: 'تاريخ بدء المطابقة',
    createdAt: 'أُنشئ',
    edit: 'تعديل',
    newKey: 'مفتاح جديد',
  },
  keys: {
    label: 'المفاتيح',
    prefix: 'المفتاح',
    createdAt: 'أُنشئ',
    lastUsed: 'آخر استخدام',
    neverUsed: 'لم يُستخدم',
    state: 'الحالة',
    active: 'فعّال',
    revoked: 'ملغى',
    revokedAt: 'أُلغي',
    actions: 'إجراءات',
    revoke: 'إلغاء المفتاح',
    empty: 'لا مفتاح',
    limit: 'للعميل مفتاحان فعّالان: ألغِ أحدهما قبل إنشاء مفتاح جديد.',
  },
  form: {
    newTitle: 'عميل جديد',
    newDescription:
      'يظهر مفتاحه الأول مرة واحدة بعد الإنشاء. يُطلب رمز من تطبيق المصادقة قبل الحفظ.',
    editTitle: 'تعديل العميل',
    editDescription: 'يُطلب رمز من تطبيق المصادقة قبل الحفظ.',
    name: 'الاسم',
    nameHint: 'اسم يميّز النظام، مثل Vertex Hub.',
    system: 'النظام',
    scopes: 'الصلاحيات',
    allowList: 'العناوين المسموح بها',
    allowListHint:
      'عنوان أو شبكة في كل سطر، مثل 203.0.113.10 أو 198.51.100.0/24. اتركه فارغًا لقبول أي عنوان.',
    documentTypes: 'أنواع المستندات التي يصدرها',
    documentTypesHint:
      'نوع يُختار هنا ينتقل إلى هذا العميل من غيره، ونوع يُزال لا يصدره أحد حتى يُسند.',
    create: 'إنشاء العميل',
    save: 'حفظ',
    nameRequired: 'أدخل اسمًا من 1 إلى 100 حرف.',
    scopesRequired: 'اختر صلاحية واحدة على الأقل.',
    allowListInvalidLine: 'سطر ليس عنوانًا ولا شبكة صحيحة:',
    allowListTooMany: 'خمسون عنوانًا على الأكثر.',
    // S08 rule 13: required with events:write or reconciliation:write, never cleared.
    reconcileFrom: 'تاريخ بدء المطابقة',
    reconcileFromHint:
      'أول تاريخ محاسبي يرسل له Hub تقرير المطابقة اليومية. لا يُمسح بعد ضبطه، ولا يُؤخَّر إلى ما بعد أيام في شهر مقفل.',
    reconcileFromRequired: 'أدخل تاريخ بدء المطابقة: يلزم مع صلاحية إرسال الأحداث أو المطابقة.',
  },
  reveal: {
    title: 'المفتاح الجديد',
    description: 'انسخ المفتاح واحفظه في إعدادات Hub الآن.',
    label: 'المفتاح',
    warning: 'لن يظهر المفتاح مرة أخرى',
    copy: 'نسخ المفتاح',
    copied: 'نُسخ',
    confirm: 'حفظت المفتاح في مكان آمن',
    done: 'تم',
  },
  newKey: {
    title: 'مفتاح جديد',
    description:
      'لتدوير المفاتيح: يبقى المفتاح الحالي فعّالًا حتى تلغيه بعد أن يستخدم Hub الجديد. يُطلب رمز من تطبيق المصادقة.',
    confirm: 'إنشاء المفتاح',
  },
  revoke: {
    title: 'إلغاء المفتاح',
    description: 'يُرفض كل طلب بهذا المفتاح فورًا، ولا يُعاد تفعيله. يُطلب رمز من تطبيق المصادقة.',
    reason: 'سبب الإلغاء',
    reasonLength: 'السبب حتى 500 حرف.',
    confirm: 'إلغاء المفتاح',
  },
};
