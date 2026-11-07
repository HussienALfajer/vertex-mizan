import type {
  AgeingBucket,
  DueDateSetter,
  ItemKind,
  ItemSource,
  MovementKind,
  OpenItemState,
} from '@vertex-mizan/contracts';

/**
 * Open items and settlements (S04): the item kinds, states and movements, the ageing buckets, and
 * the receivables labels, with the columns of the ageing and client statement exports. Terms from
 * `docs/glossary.md` (بند مستند، رصيد جارٍ، تسوية، أعمار الذمم، كشف حساب عميل، شطب دين، مقاصة مع
 * الأمانات، تاريخ الاستحقاق، معدّل في ميزان، نوع البند). The screens' text arrives with S04's screens.
 */
export const openItems = {
  kinds: {
    document: 'بند مستند',
    running: 'رصيد جارٍ',
  } satisfies Record<ItemKind, string>,
  states: {
    open: 'مفتوح',
    settled: 'مسدّد',
  } satisfies Record<OpenItemState, string>,
  movements: {
    open: 'فتح',
    add: 'إضافة',
    clear: 'تسديد',
    difference: 'فرق صرف',
  } satisfies Record<MovementKind, string>,
  sources: {
    manual: 'يدوي',
    hub_event: 'من Hub',
    opening: 'رصيد افتتاحي',
  } satisfies Record<ItemSource, string>,
  dueDateSetters: {
    opening: 'عند الفتح',
    user: 'تعديل يدوي',
    hub_event: 'من Hub',
  } satisfies Record<DueDateSetter, string>,
  buckets: {
    not_due: 'غير مستحق',
    days_1_30: '1–30 يومًا',
    days_31_60: '31–60',
    days_61_90: '61–90',
    days_91_180: '91–180',
    over_180: 'أكثر من 180',
  } satisfies Record<AgeingBucket, string>,
  labels: {
    adjusted: 'معدّل في ميزان',
    receivable: 'مستحق من العميل',
    clientStatement: 'كشف حساب عميل',
    ageing: 'أعمار الذمم',
    clientFunds: 'أمانات العملاء',
    dueOn: 'تاريخ الاستحقاق',
    daysPastDue: 'أيام التأخير',
    writeOff: 'شطب',
    itemKind: 'نوع البند',
    noClient: 'بلا عميل',
  },
  /** The ageing export's sheet: one row per item, under its client (S04 "Printing"). */
  ageingExport: {
    sheet: 'أعمار الذمم',
    asOf: 'حتى تاريخ',
    ledger: 'الدفتر',
    client: 'العميل',
    clientCode: 'رمز العميل',
    account: 'الحساب',
    reference: 'المرجع',
    documentDate: 'تاريخ المستند',
    dueOn: 'تاريخ الاستحقاق',
    daysPastDue: 'أيام التأخير',
    bucket: 'الفئة',
    currency: 'العملة',
    openAmount: 'المبلغ المفتوح',
    carryingCurrency: 'عملة الدفتر',
    carryingAmount: 'المبلغ الدفتري',
    adjusted: 'معدّل في ميزان',
  },
  /** The client statement export's sheet: the opening, every movement, the closing. */
  statementExport: {
    sheet: 'كشف حساب عميل',
    client: 'العميل',
    from: 'من تاريخ',
    to: 'إلى تاريخ',
    ledger: 'الدفتر',
    date: 'التاريخ',
    entry: 'رقم القيد',
    description: 'البيان',
    memo: 'ملاحظة السطر',
    account: 'الحساب',
    item: 'البند',
    movement: 'الحركة',
    currency: 'العملة',
    amount: 'المبلغ',
    balance: 'الرصيد بعملة البند',
    ledgerCurrency: 'عملة الدفتر',
    ledgerAmount: 'المبلغ الدفتري',
    ledgerBalance: 'الرصيد الدفتري',
    opening: 'رصيد أول المدة',
    closing: 'رصيد آخر المدة',
    adjusted: 'معدّل في ميزان',
  },
};
