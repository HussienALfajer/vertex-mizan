import type { PostingSlot } from '@vertex-mizan/contracts';

/** The posting rules' mapping (S05): the name of each slot a Hub rule reads its account from. */
export const postingRules = {
  slots: {
    receivable: 'ذمم العملاء',
    revenue_at_issue: 'الإيراد عند الإصدار',
    termination_fee_revenue: 'إيراد رسوم الإنهاء',
    'payment_method.cash': 'الصندوق (نقدًا)',
    'payment_method.bank_transfer': 'المصرف (حوالة)',
    'payment_method.e_wallet': 'المحفظة الإلكترونية',
    ad_funds: 'أمانات العملاء الإعلانية',
    ad_platforms_payable: 'ذمم المنصات الإعلانية',
    project_cost: 'تكلفة المشاريع',
    project_expense_awaiting_payment: 'مصاريف مشاريع بانتظار الدفع',
  } satisfies Record<PostingSlot, string>,
};
