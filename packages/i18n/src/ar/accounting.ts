import type { AmountTextError } from '@vertex-mizan/contracts';

/** The accounting components' text (ADR 0010 §5); terms from `docs/glossary.md`. */
export const accounting = {
  debit: 'مدين',
  credit: 'دائن',
  ledger: {
    label: 'الدفتر',
    book: 'الدفاتر',
    parallel: 'الدفتر الموازي',
  },
  period: {
    open: 'الفترة مفتوحة',
    closed: 'الفترة مقفلة',
    reopened: 'أُعيد فتح الفترة',
  },
  account: {
    header: 'حساب رئيسي',
    blocked: 'حساب موقوف',
  },
  /** SYP on printed output (ADR 0007, ADR 0009). */
  sypPrintedName: 'الليرة السورية الجديدة',
  /** Why typed text is not an amount (`AmountTextError` of the money module). */
  amountInput: {
    EMPTY: 'أدخل المبلغ.',
    INVALID: 'المبلغ غير مفهوم. اكتب أرقامًا مثل 1,250.50، أو عملية حسابية تبدأ بـ =.',
    TOO_MANY_DECIMALS: 'عدد المنازل العشرية أكبر مما تسمح به العملة.',
    NEGATIVE_NOT_ALLOWED: 'أدخل المبلغ دون إشارة سالبة.',
    DIVISION_BY_ZERO: 'لا يمكن القسمة على صفر.',
    AMOUNT_OUT_OF_RANGE: 'المبلغ خارج الحد المسموح.',
  } satisfies Record<AmountTextError, string>,
};
