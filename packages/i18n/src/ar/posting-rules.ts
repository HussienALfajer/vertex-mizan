import type { PostingSlot } from '@vertex-mizan/contracts';

/**
 * The posting rules' mapping (S05 "Screens", `/settings/posting-rules`): the name of each slot a
 * Hub rule reads its account from, the rules that group them and the mapping screen.
 */
export const postingRules = {
  nav: 'ربط قواعد الترحيل',
  title: 'ربط قواعد الترحيل',
  description:
    'الحساب الذي تقرؤه كل قاعدة ترحيل لأحداث Hub. الحدث الذي يحتاج خانة غير مربوطة يُعلّق «لا ربط للحسابات» حتى تُربط، ثم يُعاد تلقائيًا.',
  readOnly: 'تعرض هذه الصفحة الربط للقراءة فقط: يغيّره المالك أو المحاسب.',
  slots: {
    receivable: 'ذمم العملاء',
    revenue_at_issue: 'الإيراد عند الإصدار',
    termination_fee_revenue: 'إيراد رسوم الإنهاء',
    'payment_method.cash': 'الصندوق (نقدًا)',
    'payment_method.bank_transfer': 'المصرف (حوالة)',
    'payment_method.e_wallet': 'المحفظة الإلكترونية',
    ad_funds: 'أمانات العملاء الإعلانية',
    ad_platforms_payable: 'ذمم المنصات الإعلانية',
    project_cost: 'تكلفة المشاريع',
    project_expense_awaiting_payment: 'مصاريف مشاريع بانتظار الدفع',
    contract_liability: 'التزامات العقود',
    contract_asset: 'أصول العقود',
    released_revenue: 'الإيراد المحرَّر',
    cancelled_project_refund: 'مستحق الرد للعميل',
  } satisfies Record<PostingSlot, string>,
  /** What account each slot takes (S05 "Mapping slots", "Must be"). */
  fits: {
    receivable: 'حساب أصول مراقِب لبنود المستندات',
    revenue_at_issue: 'حساب إيرادات قابل للترحيل',
    termination_fee_revenue: 'حساب إيرادات قابل للترحيل',
    'payment_method.cash': 'حساب نقدي من الأصول مقيّد بعملة الخانة',
    'payment_method.bank_transfer': 'حساب نقدي من الأصول مقيّد بعملة الخانة',
    'payment_method.e_wallet': 'حساب نقدي من الأصول مقيّد بعملة الخانة',
    ad_funds: 'حساب التزامات مراقِب للرصيد الجاري، مقيّد بالدولار',
    ad_platforms_payable: 'حساب التزامات قابل للترحيل',
    project_cost: 'حساب مصاريف قابل للترحيل',
    project_expense_awaiting_payment: 'حساب التزامات قابل للترحيل',
    contract_liability: 'حساب التزامات قابل للترحيل غير نقدي',
    contract_asset: 'حساب أصول نقدي مراقِب لبنود المستندات',
    released_revenue: 'حساب إيرادات قابل للترحيل',
    cancelled_project_refund: 'حساب التزامات نقدي قابل للترحيل',
  } satisfies Record<PostingSlot, string>,
  /** The rules, each with the slots it owns on this screen and its scenario. */
  rules: {
    invoices: {
      title: 'الفواتير والإيراد عند الإصدار',
      description: 'فاتورة صادرة وإلغاؤها وتغيير خدمة سطر وتغيير تاريخ الاستحقاق.',
    },
    payments: {
      title: 'طرق الدفع',
      description:
        'الدفعات المسجّلة وإلغاؤها، والإيداع في المحفظة الإعلانية واسترداده: حساب لكل طريقة دفع وعملة.',
    },
    adFunds: {
      title: 'الأموال الإعلانية',
      description: 'الإيداع في المحفظة والصرف الإعلاني وتغييره وأرشفته.',
    },
    projectExpenses: {
      title: 'مصاريف المشاريع',
      description: 'مصروف المشروع المسجّل وتغييره وأرشفته، مقيسًا بتاريخ صرفه.',
    },
    revenueRecognition: {
      title: 'الاعتراف بالإيراد',
      description:
        'الإيراد المؤجل عند الإصدار وتحريره شهريًا، وأصول العقود للأجزاء المنقضية والمراحل المنجزة قبل فوترتها، ومستحق الرد في مشروع ملغى.',
    },
  },
  scenario: 'المثال المحلول',
  table: {
    slot: 'الخانة',
    account: 'الحساب',
    template: 'افتراضي قالب وكالة الخدمات',
    events: 'الأحداث التي تقرؤها',
    held: 'معلّقة',
    actions: 'إجراءات',
  },
  notMapped: 'غير مربوط',
  noTemplate: '—',
  heldEvents: 'معلّقة',
  noHeld: '—',
  unmappedTitle: 'خانات غير مربوطة',
  unmappedDescription:
    'كل حدث يقرأ خانة غير مربوطة يُعلّق «لا ربط للحسابات». اربط كل خانة بحساب يناسبها؛ تُعاد الأحداث المعلّقة تلقائيًا بعد الحفظ.',
  openInbox: 'الأحداث المعلّقة في صندوق الوارد',
  change: 'تغيير',
  changeTitle: 'ربط الخانة',
  picker: 'الحساب',
  pickerHint: 'تُعرض الحسابات المناسبة لهذه الخانة فقط.',
  required: 'اختر حسابًا.',
  noFitting: 'لا حساب في الدليل يناسب هذه الخانة. أضف حسابًا مناسبًا في دليل الحسابات أولًا.',
  hasOpenItems: 'للحساب المربوط الآن بنود مفتوحة: يبقى مربوطًا حتى تُسدّد بنوده أو تُقفل.',
  save: 'ربط',
};
