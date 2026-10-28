import type { Permission } from '@vertex-mizan/contracts';

/** What each permission of the permission map lets a person do (S01 "The permission map"). */
export const permissions = {
  'company.read': 'قراءة الملف التعريفي وإعدادات الدفاتر',
  'company.settings': 'تعديل الملف التعريفي وإعدادات الدفاتر ومذكرة السياسة',
  'company.archive': 'أرشفة الشركة واستعادتها',
  'members.read': 'قراءة الأعضاء والدعوات',
  'members.manage': 'دعوة الأعضاء وتغيير أدوارهم وإزالتهم',
  'audit.read': 'قراءة سجل التدقيق',
  'periods.close': 'إقفال الفترات وإعادة فتحها',
  'accounts.read': 'قراءة دليل الحسابات وأدوار الحسابات',
  'accounts.manage': 'إضافة الحسابات وتعديلها وإيقافها وأرشفتها وتطبيق القوالب',
  'dimensions.read': 'قراءة أنواع الأبعاد وقيمها',
  'dimensions.manage': 'إضافة الأبعاد وتعديلها وربطها بـ Hub وأرشفتها',
  'rates.read': 'قراءة أسعار الصرف وتقويم النشرة',
  'rates.manage': 'تسجيل أسعار الصرف وتصحيحها وتعديل تقويم النشرة',
  'entries.read': 'قراءة القيود المرحّلة وحركات الحسابات',
  'drafts.read': 'قراءة المسودات وقائمة انتظار الاعتماد',
  'drafts.manage': 'إعداد المسودات وتعديلها ونسخها وإرسالها للاعتماد وإرفاق الملفات بها',
  'entries.post': 'ترحيل القيود اليدوية وعكسها',
  'entries.approve': 'اعتماد القيود اليدوية أو رفضها',
  'entries.attach': 'إرفاق الملفات بالقيود المرحّلة',
  'integrity.read': 'تشغيل فحص السلامة',
  'company.export': 'تصدير بيانات الشركة',
} satisfies Record<Permission, string>;
