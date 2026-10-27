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
} satisfies Record<Permission, string>;
