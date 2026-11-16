/** Text shared by every Vertex Mizan screen. */
export const common = {
  productName: 'فيرتكس ميزان',
  poweredBy: 'بدعم من فيرتكس ميزان',
  retry: 'إعادة المحاولة',
  /** The installed web app: its manifest's description and the offline page (apps/web/pwa.ts). */
  app: {
    description: 'نظام محاسبة احترافي متعدد الشركات من فيرتكس.',
    offlineTitle: 'لا يوجد اتصال بالإنترنت',
    offlineBody:
      'يعمل ميزان مع الخادم مباشرة ولا يحفظ بيانات الشركة على هذا الجهاز. تحقق من اتصالك ثم أعد المحاولة.',
  },
  close: 'إغلاق',
  cancel: 'تراجع',
  save: 'احفظ',
  /** Between the items of a list written in a sentence. */
  listSeparator: '، ',
  errorTitle: 'حدث خطأ غير متوقع',
  errorDescription: 'لم تكتمل العملية. أعد المحاولة، وإن تكرر الخطأ فتواصل مع الدعم.',
  /** The title of a refused form's error summary (ADR 0010 §4). */
  errorSummary: 'راجع ما يلي قبل المتابعة',
  theme: {
    toDark: 'فعّل الوضع الداكن',
    toLight: 'فعّل الوضع الفاتح',
  },
  density: {
    label: 'كثافة العرض',
    auto: 'تلقائية',
    compact: 'مضغوطة',
    comfortable: 'مريحة',
  },
};
