/**
 * The design system's own page (`packages/ui/preview`, then `apps/web`'s design-system page): its
 * headings and its synthetic examples. No real company, account or amount (AGENTS.md).
 */
export const designSystem = {
  title: 'نظام التصميم',
  subtitle: 'مكوّنات فيرتكس ميزان بكثافتيها، للوضعين الفاتح والداكن',
  densities: 'الكثافتان جنبًا إلى جنب',
  entry: {
    title: 'قيد يومية',
    number: 'رقم القيد',
    date: 'التاريخ',
    line: 'السطر',
    account: 'الحساب',
    description: 'البيان',
    total: 'المجموع',
    difference: 'الفرق',
    balanced: 'القيد متوازن',
    descriptions: [
      'تحصيل دفعة من عميل',
      'تحصيل دفعة من عميل',
      'حملة إعلانية',
      'سداد قيمة الحملة الإعلانية',
    ],
  },
  accounts: {
    bank: 'المصرف - الحساب الجاري',
    receivables: 'ذمم العملاء',
    revenue: 'إيرادات خدمات التسويق',
    fees: 'مصاريف Google Ads',
    expenses: 'المصاريف',
    oldCash: 'صندوق الفرع القديم',
  },
  report: {
    title: 'ميزان المراجعة',
    balance: 'الرصيد',
    assets: 'الأصول',
    liabilities: 'الالتزامات',
    subtotal: 'مجموع الأصول',
    grandTotal: 'صافي المركز',
  },
  amounts: {
    title: 'المبالغ',
    negative: 'سالب',
    zero: 'صفر',
    zeroDash: 'صفر في قائمة مالية',
    largest: 'أكبر مبلغ يمكن تخزينه',
    withCode: 'مع رمز العملة',
    inSentence: 'داخل نص عربي',
    sentenceBefore: 'رصيد الحساب',
    sentenceAfter: 'في نهاية الفترة.',
    strong: 'مجموع بخط عريض: الفواصل بوزن عادي فتبقى الأرقام على استقامة واحدة',
  },
  input: {
    title: 'إدخال المبالغ',
    free: 'مبلغ (يقبل السالب)',
    debit: 'مدين (دون إشارة)',
    hint: 'جرّب: 1250.5 أو =1000*1.125 أو =10/3، أو اكتب الأرقام من لوحة مفاتيح عربية.',
    stored: 'المخزَّن بالوحدات الصغرى',
  },
  controls: {
    title: 'عناصر التحكم',
    primary: 'رحّل القيد',
    secondary: 'احفظ كمسودة',
    outline: 'تصدير',
    search: 'ابحث برقم الحساب أو اسمه',
    currency: 'العملة',
  },
  states: {
    title: 'الحالات',
  },
};
