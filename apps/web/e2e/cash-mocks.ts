import type {
  Account,
  CashAccountRef,
  CashPosition,
  CashStatement,
  DraftInput,
  EntryPreview,
  PostedDraft,
  Voucher,
  VoucherSummary,
} from '@vertex-mizan/contracts';
import { accountOf, chart } from './chart-mocks';
import { draftOf, entryReads, ownerRef, purchase, purchasePreview } from './entry-mocks';

/*
 * Synthetic answers of the cash API (S11) in the company's shape of the other specs (SYP book, USD
 * parallel): the SYP box `111001`, the USD box `111002` and the USD bank `111004` marked as cash
 * accounts; the position on the tests' today; the USD box's statement with a receipt, a cancelled
 * payment and a count; and four vouchers, one of each kind.
 */

const voucherId = (n: number) => `01900000-0000-7000-800e-${String(n).padStart(12, '0')}`;
const cashEntryId = (n: number) => `01900000-0000-7000-8009-${String(n + 40).padStart(12, '0')}`;

const cashKinds: Record<string, 'box' | 'bank'> = {
  '111001': 'box',
  '111002': 'box',
  '111003': 'bank',
  '111004': 'bank',
};

/** The chart with its cash accounts marked, as `GET /api/accounts` answers. */
export const cashChart = (chart: readonly Account[]): Account[] =>
  chart.map((account) => ({ ...account, cashKind: cashKinds[account.code] ?? null }));

const ref = (code: string): CashAccountRef => {
  const account = accountOf(code);
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    nameLatin: null,
    cashKind: cashKinds[code] ?? 'box',
    currency: account.currency ?? 'SYP',
  };
};

export const sypBox = ref('111001');
export const usdBox = ref('111002');
export const usdBank = ref('111004');

const usd = (amountMinor: string) => ({ amountMinor, currency: 'USD' as const });
const syp = (amountMinor: string) => ({ amountMinor, currency: 'SYP' as const });

/** The position: 5,000.00 SYP in the box; 1,500.00 USD in the box; the bank at zero. */
export const position: CashPosition = {
  asOf: '2026-11-09',
  bookCurrency: 'SYP',
  parallelCurrency: 'USD',
  groups: [
    {
      currency: 'SYP',
      accounts: [{ ...sypBox, balance: syp('500000'), book: syp('500000'), parallel: usd('4115') }],
      total: syp('500000'),
      book: syp('500000'),
      parallel: usd('4115'),
    },
    {
      currency: 'USD',
      accounts: [
        { ...usdBox, balance: usd('150000'), book: syp('18225000'), parallel: usd('150000') },
        { ...usdBank, balance: usd('0'), book: syp('0'), parallel: usd('0') },
      ],
      total: usd('150000'),
      book: syp('18225000'),
      parallel: usd('150000'),
    },
  ],
  book: syp('18725000'),
  parallel: usd('154115'),
};

export const emptyPosition: CashPosition = {
  ...position,
  groups: [],
  book: syp('0'),
  parallel: usd('0'),
};

const voucherSummary = (
  n: number,
  fields: Partial<VoucherSummary> & Pick<VoucherSummary, 'kind' | 'amount'>,
): VoucherSummary => ({
  id: voucherId(n),
  fiscalYear: 2026,
  number: 1,
  date: '2026-11-05',
  state: 'posted',
  cashAccount: usdBox,
  counterCashAccount: null,
  partyName: null,
  description: 'سند تجريبي',
  entry: { id: cashEntryId(n), fiscalYear: 2026, number: 10 + n },
  reversal: null,
  expectedMinor: null,
  countedMinor: null,
  ...fields,
});

export const receipt = voucherSummary(1, {
  kind: 'receipt',
  amount: usd('200000'),
  partyName: 'عميل تجريبي',
  description: 'دفعة من مستخلص',
});
export const payment = voucherSummary(2, {
  kind: 'payment',
  date: '2026-11-06',
  amount: usd('50000'),
  partyName: 'مورد تجريبي',
  description: 'دفعة لمورد',
  state: 'cancelled',
  reversal: { id: cashEntryId(9), fiscalYear: 2026, number: 19 },
});
export const exchange = voucherSummary(3, {
  kind: 'transfer',
  date: '2026-11-07',
  amount: usd('101000'),
  counterCashAccount: sypBox,
  description: 'صرف عملة',
});
export const count = voucherSummary(4, {
  kind: 'count',
  date: '2026-11-08',
  amount: usd('0'),
  entry: null,
  description: 'جرد نهاية اليوم',
  expectedMinor: '150000',
  countedMinor: '150000',
});

export const vouchers = [count, exchange, payment, receipt];

/** The receipt's page: its entry, the spec's purchase reshaped as a receipt's. */
export const receiptVoucher: Voucher = {
  ...receipt,
  draftId: purchase.draftId ?? voucherId(90),
  preparedBy: ownerRef,
  approvedBy: null,
  entryDetail: {
    ...purchase,
    id: cashEntryId(1),
    number: 11,
    description: 'دفعة من مستخلص',
    voucher: { id: receipt.id, kind: 'receipt', fiscalYear: 2026, number: 1 },
  },
  createdAt: '2026-11-05T09:00:00.000Z',
};

export const countVoucher: Voucher = {
  ...count,
  draftId: voucherId(91),
  preparedBy: ownerRef,
  approvedBy: null,
  entryDetail: null,
  createdAt: '2026-11-08T09:00:00.000Z',
};

/** The USD box's statement for November: opening 0, a receipt, a cancelled payment, a count. */
export const statement: CashStatement = {
  account: usdBox,
  from: '2026-11-01',
  to: '2026-11-09',
  ledgers: [],
  bookCurrency: 'SYP',
  parallelCurrency: 'USD',
  opening: { amount: usd('0'), book: null, parallel: null },
  rows: [
    {
      kind: 'line',
      date: '2026-11-05',
      entry: { id: cashEntryId(1), fiscalYear: 2026, number: 11, lineNo: 1 },
      voucher: { id: receipt.id, kind: 'receipt', fiscalYear: 2026, number: 1 },
      description: 'دفعة من مستخلص',
      counterAccount: {
        id: accountOf('112001').id,
        code: '112001',
        name: accountOf('112001').name,
      },
      severalCounterAccounts: false,
      counterparty: { id: voucherId(80), code: 'C-1', name: 'عميل تجريبي' },
      contract: null,
      in: '200000',
      out: '0',
      balance: '200000',
      book: null,
      parallel: null,
      expectedMinor: null,
      countedMinor: null,
    },
    {
      kind: 'line',
      date: '2026-11-06',
      entry: { id: cashEntryId(2), fiscalYear: 2026, number: 12, lineNo: 2 },
      voucher: { id: payment.id, kind: 'payment', fiscalYear: 2026, number: 1 },
      description: 'دفعة لمورد',
      counterAccount: null,
      severalCounterAccounts: true,
      counterparty: null,
      contract: null,
      in: '0',
      out: '50000',
      balance: '150000',
      book: null,
      parallel: null,
      expectedMinor: null,
      countedMinor: null,
    },
    {
      kind: 'count',
      date: '2026-11-08',
      entry: null,
      voucher: { id: count.id, kind: 'count', fiscalYear: 2026, number: 1 },
      description: 'جرد نهاية اليوم',
      counterAccount: null,
      severalCounterAccounts: false,
      counterparty: null,
      contract: null,
      in: '0',
      out: '0',
      balance: '150000',
      book: null,
      parallel: null,
      expectedMinor: '150000',
      countedMinor: '150000',
    },
  ],
  totalIn: '200000',
  totalOut: '50000',
  closing: { amount: usd('150000'), book: null, parallel: null },
};

/** A voucher draft as the API returns it, from typed input. */
export function voucherDraftOf(input: DraftInput, id: string) {
  return draftOf(input, {
    id,
    voucher: input.voucher
      ? {
          kind: input.voucher.kind,
          cashAccountId: input.voucher.cashAccountId,
          counterCashAccountId: input.voucher.counterCashAccountId ?? null,
          partyName: input.voucher.partyName ?? null,
          countedMinor: input.voucher.countedMinor ?? null,
        }
      : null,
  });
}

/** The preview of a voucher: the spec's lines, and the voucher's part. */
export const voucherPreview = (voucher: EntryPreview['voucher']): EntryPreview => ({
  ...purchasePreview,
  voucher,
});

/** A posted voucher draft's answer. */
export function postedVoucher(
  input: DraftInput,
  id: string,
  voucher: { id: string; kind: VoucherSummary['kind']; number: number },
  entry: boolean,
): PostedDraft {
  return {
    draft: { ...voucherDraftOf(input, id), state: 'posted' },
    entry: entry
      ? {
          ...purchase,
          id: cashEntryId(30),
          number: 30,
          voucher: { id: voucher.id, kind: voucher.kind, fiscalYear: 2026, number: voucher.number },
        }
      : null,
    voucher: { ...voucher, fiscalYear: 2026 },
  };
}

/** Every read of the cash screens and the voucher form, answered. */
export const cashReads = {
  ...entryReads,
  'GET /api/accounts': { status: 200, json: cashChart(chart) },
  'GET /api/cash/accounts': { status: 200, json: position },
  [`GET /api/cash/accounts/${usdBox.id}/statement`]: { status: 200, json: statement },
  'GET /api/vouchers': (request: { url(): string }) => {
    const params = new URL(request.url()).searchParams;
    const listed = vouchers.filter(
      (voucher) =>
        (!params.get('kind') || voucher.kind === params.get('kind')) &&
        (!params.get('state') || voucher.state === params.get('state')) &&
        (!params.get('cashAccount') ||
          voucher.cashAccount.id === params.get('cashAccount') ||
          voucher.counterCashAccount?.id === params.get('cashAccount')),
    );
    return { status: 200, json: { vouchers: listed, nextCursor: null } };
  },
  [`GET /api/vouchers/${receipt.id}`]: { status: 200, json: receiptVoucher },
  [`GET /api/vouchers/${count.id}`]: { status: 200, json: countVoucher },
};
