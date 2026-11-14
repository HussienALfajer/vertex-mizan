import type { ChecklistItemName, ChecklistResult, PeriodState } from '@vertex-mizan/contracts';

/**
 * Periods and the close (S07 "Screens", "Arabic strings"): the months with their states, a month's
 * pre-close checklist and history, and the close and reopen dialogs. Terms from
 * `docs/glossary.md` (الفترة، إقفال الشهر، إعادة فتح الشهر، قائمة التحقق قبل الإقفال).
 */
export const periods = {
  nav: 'الفترات',
  title: 'الفترات',
  description: 'الأشهر من أول فترة إلى الشهر الجاري، بحالتها وقائمة التحقق قبل إقفالها.',
  period: 'الفترة',
  states: {
    open: 'مفتوحة',
    closed: 'مقفلة',
    reopened: 'معاد فتحها',
  } satisfies Record<PeriodState, string>,
  table: {
    label: 'الفترات',
    period: 'الفترة',
    state: 'الحالة',
    ended: 'انتهى الشهر',
    checklist: 'قائمة التحقق',
    lastEvent: 'آخر حدث',
    endedYes: 'انتهى',
    endedNo: 'لم ينتهِ بعد',
    allPassed: 'كل البنود ناجحة',
    failing: 'بنود غير ناجحة',
    none: '—',
    open: 'افتح الشهر',
  },
  empty: {
    title: 'لا فترات بعد',
    description: 'تظهر الأشهر هنا بعد أول قيد مرحّل.',
  },
  events: {
    closed: 'أُقفل',
    reopened: 'أُعيد فتحه',
  },
  eventBy: 'بواسطة',
  detail: {
    back: 'الفترات',
    title: 'الفترة',
    notFound: 'لا فترة بهذا الشهر.',
    firstPeriod: 'أول فترة',
    ended: 'انتهى الشهر بتوقيت دمشق',
    notEnded: 'لم ينتهِ الشهر بعد بتوقيت دمشق: يُقفل بعد انتهائه.',
    checklist: 'قائمة التحقق قبل الإقفال',
    summary: 'البنود الناجحة',
    history: 'سجل الإقفال وإعادة الفتح',
    noHistory: 'لم يُقفل هذا الشهر بعد.',
    reason: 'السبب',
    user: 'الشخص',
    at: 'الوقت',
    kind: 'الحدث',
    revaluation: 'إعادة تقييم الشهر',
  },
  checklist: {
    items: {
      bulletins_recorded: 'النشرات مسجلة',
      closing_rates_recorded: 'أسعار الإقفال مسجلة',
      no_drafts: 'لا مسودات',
      open_items_agree: 'البنود المفتوحة تطابق حساباتها',
      no_held_events: 'لا أحداث معلقة',
      releases_posted: 'الإيرادات المؤجلة محررة',
      revaluation_current: 'إعادة التقييم حالية',
      reconciliation_clean: 'المطابقة اليومية نظيفة',
    } satisfies Record<ChecklistItemName, string>,
    unknownItem: 'بند غير معروف',
    results: {
      passed: 'ناجح',
      failed: 'غير ناجح',
      not_applicable: 'لا ينطبق',
    } satisfies Record<ChecklistResult, string>,
    counts: {
      bulletins_recorded: 'أيام نشر بلا نشرة',
      closing_rates_recorded: 'أسعار إقفال ناقصة',
      no_drafts: 'مسودات مؤرخة في الشهر',
      open_items_agree: 'حسابات رقابة لا تطابق بنودها',
      no_held_events: 'أحداث معلقة',
      releases_posted: 'تحريرات ناقصة',
      revaluation_current: 'دفاتر إعادة تقييمها غير حالية',
      reconciliation_clean: 'أيام مطابقة غير نظيفة',
    } satisfies Record<ChecklistItemName, string>,
    links: {
      bulletins_recorded: 'تقويم النشرة',
      closing_rates_recorded: 'إعادة التقييم',
      no_drafts: 'المسودات',
      open_items_agree: 'فحص السلامة',
      revaluation_current: 'إعادة التقييم',
    } satisfies Partial<Record<ChecklistItemName, string>>,
    ledgers: 'في',
  },
  reasonLength: 'السبب حتى 500 حرف.',
  close: {
    action: 'إقفال الشهر',
    title: 'إقفال الشهر',
    description:
      'لا يُرحَّل بعد الإقفال أي قيد مؤرخ في هذا الشهر، وتُعلَّق أحداث Hub المؤرخة فيه حتى يُعاد فتحه.',
    reason: 'سبب الإقفال',
    confirm: 'أقفل الشهر',
    done: 'أُقفل الشهر.',
    blocked: 'يُقفل الشهر عندما تنجح كل بنود قائمة التحقق.',
    notEnded: 'يُقفل الشهر بعد انتهائه بتوقيت دمشق.',
    outOfOrder: 'تُقفل الأشهر بالترتيب: أقفل الأشهر السابقة أولاً.',
    failing: 'البنود غير الناجحة',
    order: 'الشهر المذكور',
  },
  reopen: {
    action: 'إعادة فتح الشهر',
    title: 'إعادة فتح الشهر',
    description:
      'يُعاد فتح آخر شهر مقفل وحده. تُعاد محاولة الأحداث المعلقة المؤرخة فيه بعد إعادة الفتح، وقد تحتاج إعادة التقييم إلى قيد تسوية قبل الإقفال مجددًا.',
    reason: 'سبب إعادة الفتح',
    confirm: 'أعد فتح الشهر',
    done: 'أُعيد فتح الشهر.',
  },
  palette: 'الفترات',
};
