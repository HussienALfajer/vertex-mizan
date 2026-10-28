import type { ExportState } from '@vertex-mizan/contracts';

/**
 * The owner's full export of the company's data (S03 rule 21). Terms from `docs/glossary.md`
 * (تصدير بيانات الشركة، رأس السلسلة).
 */
export const exportData = {
  nav: 'تصدير البيانات',
  title: 'تصدير بيانات الشركة',
  description:
    'ملف ZIP بكل بيانات الشركة: الإعدادات والدليل والأبعاد والأسعار والقيود وسطورها والمسودات والفترات وسجل التدقيق، بصيغتي JSON و CSV، مع المرفقات وبيان بالبصمات ورأس السلسلة. يصلك بريد حين يجهز، ويبقى للتنزيل 24 ساعة ثم يُحذف.',
  request: 'اطلب تصديرًا',
  inProgress: 'يُجهَّز تصدير الآن: انتظر حتى يجهز قبل طلب آخر.',
  requested: 'طُلب التصدير. يصلك بريد حين يجهز.',
  download: 'نزّل',
  states: {
    queued: 'قيد التجهيز',
    ready: 'جاهز',
    failed: 'تعذّر',
    expired: 'انتهت صلاحيته',
  } satisfies Record<ExportState, string>,
  table: {
    label: 'التصديرات',
    requestedAt: 'طُلب في',
    requestedBy: 'طلبه',
    state: 'الحالة',
    size: 'الحجم (ك.ب)',
    expiresAt: 'متاح حتى',
    sha256: 'البصمة',
    actions: 'إجراءات',
  },
  copyHash: 'انسخ البصمة',
  copied: 'نُسخت',
  failedHint: 'تعذّر تجهيز هذا التصدير. اطلب تصديرًا جديدًا، فإن تكرر فتواصل مع Vertex.',
  empty: {
    title: 'لا تصديرات بعد',
    description: 'اطلب تصديرًا لتحصل على نسخة كاملة من بيانات الشركة.',
  },
} as const;
