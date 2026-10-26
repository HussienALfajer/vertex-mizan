import type { ErrorCode } from '@vertex-mizan/contracts';

/** The Arabic text of every error code front ends show (ADR 0006); the server's message is for logs. */
export const errors = {
  AMOUNT_OUT_OF_RANGE: 'المبلغ خارج الحد المسموح.',
  INVALID_RATE: 'سعر الصرف غير صالح.',
  RATE_PAIR_MISMATCH: 'سعر الصرف لا يحوّل بين هاتين العملتين.',
  CROSS_RATE_MISMATCH: 'سعرا الصرف المتقاطعان من نوعين مختلفين أو بتاريخ لاحق لتاريخ القيد.',
  RATE_MISSING: 'لا يوجد سعر صرف لهذا التاريخ.',
  SYP_BEFORE_REDENOMINATION: 'لا تُقبل مبالغ أو أسعار بالليرة السورية قبل 1 كانون الثاني 2026.',
  ENTRY_UNBALANCED: 'القيد غير متوازن.',
  ENTRY_TOO_FEW_LINES: 'يحتاج القيد إلى سطرين على الأقل.',
  RELEASE_EXCEEDS_BALANCE: 'المبلغ أكبر من الرصيد المتبقي.',
  VALIDATION_FAILED: 'بعض الحقول غير صالحة. راجعها ثم أعد المحاولة.',
  UNAUTHENTICATED: 'انتهت الجلسة. سجّل الدخول من جديد.',
  INVALID_CREDENTIALS: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  INVALID_TWO_FACTOR_CODE: 'الرمز غير صحيح أو انتهت صلاحيته.',
  TWO_FACTOR_REQUIRED: 'فعّل المصادقة الثنائية أولًا.',
  REAUTHENTICATION_REQUIRED: 'أدخل رمز المصادقة الثنائية لتأكيد هذا الإجراء.',
  FORBIDDEN: 'لا تملك صلاحية هذا الإجراء.',
  NOT_FOUND: 'العنصر غير موجود.',
  COMPANY_NOT_SELECTED: 'اختر شركة أولًا.',
  COMPANY_SWITCHED: 'تغيّرت الشركة النشطة في نافذة أخرى. أعد تحميل الصفحة قبل الحفظ.',
  COMPANY_ARCHIVED: 'الشركة مؤرشفة وللقراءة فقط.',
  COMPANY_SETTINGS_LOCKED: 'لا تتغير إعدادات الدفاتر بعد ترحيل أول قيد.',
  LAST_OWNER: 'يجب أن يبقى للشركة مالك واحد على الأقل.',
  MEMBERSHIP_EXISTS: 'هذا البريد لعضو في الشركة.',
  INVITATION_EXISTS: 'توجد دعوة معلّقة لهذا البريد.',
  LINK_INVALID: 'الرابط منتهي الصلاحية أو مستخدم أو ملغى.',
  INVITATION_EMAIL_MISMATCH: 'الدعوة لبريد إلكتروني آخر.',
  RESET_NOT_ALLOWED:
    'لا يمكنك إعادة ضبط المصادقة الثنائية لهذا العضو لأنه عضو في شركة لست مالكها. تتولاها إدارة النظام.',
  RATE_LIMITED: 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.',
} satisfies Record<ErrorCode, string>;
