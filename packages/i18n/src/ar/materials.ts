/**
 * The materials catalogue (S12 rule 3, N4): `/materials`, its dialog, `MaterialPicker`'s labels and
 * the quantity fields of a line. Terms from `docs/glossary.md`.
 */
export const materials = {
  title: 'دليل المواد',
  description:
    'المواد التي تُشترى للمشاريع، كلٌّ برمزه واسمه ووحدته. تُطلب المادة والكمية على كل سطر في حساب يتطلب مادة.',
  nav: 'دليل المواد',
  code: 'الرمز',
  name: 'الاسم',
  nameLatin: 'الاسم اللاتيني',
  unit: 'الوحدة',
  quantity: 'الكمية',
  unitPrice: 'سعر الوحدة',
  average: 'متوسط تكلفة الوحدة',
  priceAdjustment: 'تعديل سعر',
  state: 'الحالة',
  active: 'فعّالة',
  archived: 'مؤرشفة',
  search: 'بحث بالرمز أو الاسم',
  showArchived: 'عرض المؤرشفة',
  add: 'مادة جديدة',
  edit: 'تعديل',
  editMaterial: 'تعديل {name}',
  archive: 'أرشفة',
  archiveTitle: 'أرشفة المادة',
  archiveDescription: 'لا تُختار المادة المؤرشفة في سطور جديدة، وتبقى سطورها وكمياتها في التقارير.',
  more: 'عرض المزيد',
  empty: 'لا توجد مواد بعد',
  emptyHint: 'أضف المواد التي تشتريها للمشاريع مع وحداتها.',
  emptySearch: 'لا مادة بهذا البحث',
  unitLocked: 'الوحدة مقفلة: استُخدمت المادة في سطر مرحّل.',
  unitHint: 'مثل: طن، م³، كيس، قطعة.',
  saved: 'حُفظت المادة',
  dialog: {
    newTitle: 'مادة جديدة',
    editTitle: 'تعديل مادة',
    description: 'رمز فريد للمادة واسمها ووحدتها.',
    submit: 'حفظ',
    cancel: 'إلغاء',
  },
  validation: {
    code: 'أدخل رمزًا من 1 إلى 30 حرفًا',
    name: 'أدخل اسمًا من 1 إلى 200 حرف',
    unit: 'أدخل وحدة من 1 إلى 20 حرفًا',
  },
  /** `MaterialPicker`'s labels. */
  picker: {
    placeholder: 'اختر مادة',
    empty: 'لا مادة بهذا الاسم',
    unit: 'الوحدة',
    archived: 'مؤرشفة',
  },
};
