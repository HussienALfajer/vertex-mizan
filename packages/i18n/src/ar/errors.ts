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
} satisfies Record<ErrorCode, string>;
