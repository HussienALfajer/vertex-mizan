import type {
  AgeingReport,
  ClientFunds,
  ClientRef,
  ClientStatement,
  OpenItem,
  OpenItemSummary,
} from '@vertex-mizan/contracts';
import { accountOf } from './chart-mocks';
import { hubClient, manualClient } from './dimension-mocks';
import { entryReads, ownerRef } from './entry-mocks';

/*
 * Synthetic answers of the receivables API (S04), on the spec's example shifted before the tests'
 * today (2026-11-09): invoice M-1 of 1,000.00 USD opened on 3 November at 120 (120,000.00 SYP),
 * due 3 December, with a first receipt of 400.00 USD on 5 November clearing 48,000.00 SYP; an
 * older M-0 of 250.00 USD past due; a Hub invoice of a second client adjusted in Mizan; and each
 * client's ad funds on 213001.
 */

const itemId = (n: number) => `01900000-0000-7000-800c-${String(n).padStart(12, '0')}`;
const entryId = (n: number) => `01900000-0000-7000-8009-${String(n + 10).padStart(12, '0')}`;
const movementId = (n: number) => `01900000-0000-7000-800d-${String(n).padStart(12, '0')}`;

const receivables = accountOf('112001');
const funds = accountOf('213001');
const receivablesRef = { id: receivables.id, code: receivables.code, name: receivables.name };
const fundsRef = { id: funds.id, code: funds.code, name: funds.name };

export const client: ClientRef = {
  id: manualClient.id,
  code: manualClient.code,
  name: manualClient.name,
};
const otherClient: ClientRef = { id: hubClient.id, code: null, name: hubClient.name };

const summary = (
  n: number,
  fields: Partial<OpenItemSummary> & Pick<OpenItemSummary, 'reference' | 'amounts'>,
): OpenItemSummary => ({
  id: itemId(n),
  account: receivablesRef,
  kind: 'document',
  source: 'manual',
  client,
  currency: 'USD',
  documentDate: '2026-11-03',
  dueOn: '2026-12-03',
  state: 'open',
  adjusted: false,
  ...fields,
});

/** M-1 after its first receipt: 600.00 USD open, carried at 72,000.00 SYP. */
export const m1 = summary(1, {
  reference: 'M-1',
  amounts: { openMinor: '60000', bookMinor: '7200000', parallelMinor: '60000' },
});

/** M-0: 250.00 USD from August, 69 days past due on 9 November. */
export const m0 = summary(2, {
  reference: 'M-0',
  documentDate: '2026-08-01',
  dueOn: '2026-09-01',
  amounts: { openMinor: '25000', bookMinor: '3000000', parallelMinor: '25000' },
});

/** A Hub invoice of the second client, in SYP, with a manual movement on it. */
export const hubItem = summary(3, {
  reference: 'INV-2026-077',
  source: 'hub_event',
  client: otherClient,
  currency: 'SYP',
  documentDate: '2026-09-20',
  dueOn: '2026-10-20',
  adjusted: true,
  amounts: { openMinor: '5000000', bookMinor: '5000000', parallelMinor: '40650' },
});

const movement = (
  n: number,
  fields: Pick<OpenItem['movements'][number], 'kind' | 'entryDate' | 'amounts' | 'balance'> & {
    number: number;
  },
): OpenItem['movements'][number] => ({
  id: movementId(n),
  adjusted: false,
  entryId: entryId(fields.number),
  fiscalYear: 2026,
  description: fields.kind === 'open' ? 'فاتورة خدمات تسويق' : 'سند قبض',
  lineNo: 1,
  memo: null,
  ...fields,
});

/** M-1 with its opening and its first receipt. */
export const m1Item: OpenItem = {
  ...m1,
  asOf: '2026-11-09',
  hubDocument: null,
  hubEventId: null,
  openedByEntryId: entryId(3),
  bookCurrency: 'SYP',
  parallelCurrency: 'USD',
  movements: [
    movement(1, {
      kind: 'open',
      number: 3,
      entryDate: '2026-11-03',
      amounts: { openMinor: '100000', bookMinor: '12000000', parallelMinor: '100000' },
      balance: { openMinor: '100000', bookMinor: '12000000', parallelMinor: '100000' },
    }),
    movement(2, {
      kind: 'clear',
      number: 4,
      entryDate: '2026-11-05',
      amounts: { openMinor: '-40000', bookMinor: '-4800000', parallelMinor: '-40000' },
      balance: { openMinor: '60000', bookMinor: '7200000', parallelMinor: '60000' },
    }),
  ],
  dueDates: [
    {
      dueOn: '2026-12-03',
      effectiveOn: '2026-11-03',
      setBy: 'opening',
      by: null,
      reason: null,
      createdAt: '2026-11-03T08:00:00.000Z',
    },
  ],
};

/** M-1 after the due-date change of the test: 3 January, with its reason. */
export const m1Extended: OpenItem = {
  ...m1Item,
  dueOn: '2027-01-03',
  dueDates: [
    ...m1Item.dueDates,
    {
      dueOn: '2027-01-03',
      effectiveOn: '2026-11-09',
      setBy: 'user',
      by: ownerRef,
      reason: 'تمديد متفق عليه مع العميل (مثال)',
      createdAt: '2026-11-09T06:00:00.000Z',
    },
  ],
};

/** The Hub item: its due date comes from Hub, the manual write-off movement adjusted. */
export const hubOpenItem: OpenItem = {
  ...hubItem,
  asOf: '2026-11-09',
  // The posted invoice of `inbox-mocks.ts`.
  hubEventId: '01900000-0000-7000-a000-000000000001',
  hubDocument: {
    type: 'invoice',
    id: '01900000-0000-7000-9000-000000000077',
    number: 'INV-2026-077',
  },
  openedByEntryId: entryId(1),
  bookCurrency: 'SYP',
  parallelCurrency: 'USD',
  movements: [
    movement(3, {
      kind: 'open',
      number: 1,
      entryDate: '2026-09-20',
      amounts: { openMinor: '6000000', bookMinor: '6000000', parallelMinor: '48780' },
      balance: { openMinor: '6000000', bookMinor: '6000000', parallelMinor: '48780' },
    }),
    {
      ...movement(4, {
        kind: 'clear',
        number: 5,
        entryDate: '2026-11-06',
        amounts: { openMinor: '-1000000', bookMinor: '-1000000', parallelMinor: '-8130' },
        balance: { openMinor: '5000000', bookMinor: '5000000', parallelMinor: '40650' },
      }),
      adjusted: true,
      memo: 'خصم متفق عليه (مثال)',
    },
  ],
  dueDates: [
    {
      dueOn: '2026-10-20',
      effectiveOn: '2026-09-20',
      setBy: 'hub_event',
      by: null,
      reason: null,
      createdAt: '2026-09-20T08:00:00.000Z',
    },
  ],
};

const buckets = (fields: Partial<Record<string, string>>) => ({
  not_due: '0',
  days_1_30: '0',
  days_31_60: '0',
  days_61_90: '0',
  days_91_180: '0',
  over_180: '0',
  ...fields,
});

const ageingItem = (item: OpenItemSummary, daysPastDue: number) => ({
  itemId: item.id,
  account: item.account,
  reference: item.reference,
  currency: item.currency,
  documentDate: item.documentDate,
  dueOn: item.dueOn ?? item.documentDate,
  daysPastDue,
  bucket:
    daysPastDue <= 0
      ? ('not_due' as const)
      : daysPastDue <= 30
        ? ('days_1_30' as const)
        : ('days_61_90' as const),
  openMinor: item.amounts.openMinor,
  carryingMinor: item.amounts.bookMinor,
  adjusted: item.adjusted,
});

/** The ageing as of 9 November in the book ledger (SYP). */
export const ageing: AgeingReport = {
  asOf: '2026-11-09',
  ledger: 'book',
  ledgerCurrency: 'SYP',
  accounts: [receivablesRef],
  clients: [
    {
      client,
      buckets: buckets({ not_due: '7200000', days_61_90: '3000000' }),
      totalMinor: '10200000',
      items: [ageingItem(m0, 69), ageingItem(m1, -24)],
    },
    {
      client: otherClient,
      buckets: buckets({ days_1_30: '5000000' }),
      totalMinor: '5000000',
      items: [ageingItem(hubItem, 20)],
    },
  ],
  buckets: buckets({ not_due: '7200000', days_1_30: '5000000', days_61_90: '3000000' }),
  totalMinor: '15200000',
  currencyTotals: [
    {
      currency: 'SYP',
      buckets: buckets({ days_1_30: '5000000' }),
      totalMinor: '5000000',
    },
    {
      currency: 'USD',
      buckets: buckets({ not_due: '60000', days_61_90: '25000' }),
      totalMinor: '85000',
    },
  ],
};

/** The ageing as of a date with nothing open. */
export const emptyAgeing: AgeingReport = {
  ...ageing,
  clients: [],
  buckets: buckets({}),
  totalMinor: '0',
  currencyTotals: [],
};

const statementLine = (
  n: number,
  item: OpenItemSummary,
  fields: Pick<
    ClientStatement['lines'][number],
    'kind' | 'entryDate' | 'amountMinor' | 'ledgerMinor' | 'balanceMinor' | 'ledgerBalanceMinor'
  > & { number: number },
): ClientStatement['lines'][number] => ({
  movementId: movementId(10 + n),
  entryId: entryId(fields.number),
  fiscalYear: 2026,
  description: fields.kind === 'open' ? 'فاتورة خدمات تسويق' : 'سند قبض',
  memo: null,
  itemId: item.id,
  itemReference: item.reference,
  itemKind: 'document',
  account: item.account,
  adjusted: false,
  currency: item.currency,
  ...fields,
});

/** The first client's statement over every date: M-0, then M-1 opened and partly received. */
export const statement: ClientStatement = {
  client,
  from: null,
  to: '2026-11-09',
  ledger: 'book',
  ledgerCurrency: 'SYP',
  currency: null,
  opening: [],
  openingLedgerMinor: '0',
  lines: [
    statementLine(1, m0, {
      kind: 'open',
      number: 2,
      entryDate: '2026-08-01',
      amountMinor: '25000',
      ledgerMinor: '3000000',
      balanceMinor: '25000',
      ledgerBalanceMinor: '3000000',
    }),
    statementLine(2, m1, {
      kind: 'open',
      number: 3,
      entryDate: '2026-11-03',
      amountMinor: '100000',
      ledgerMinor: '12000000',
      balanceMinor: '125000',
      ledgerBalanceMinor: '15000000',
    }),
    statementLine(3, m1, {
      kind: 'clear',
      number: 4,
      entryDate: '2026-11-05',
      amountMinor: '-40000',
      ledgerMinor: '-4800000',
      balanceMinor: '85000',
      ledgerBalanceMinor: '10200000',
    }),
  ],
  closing: [{ currency: 'USD', amountMinor: '85000', ledgerMinor: '10200000' }],
  closingLedgerMinor: '10200000',
};

/** The ad funds on 9 November: one client's funds held, the other's debit balance. */
export const clientFunds: ClientFunds = {
  asOf: '2026-11-09',
  ledger: 'book',
  bookCurrency: 'SYP',
  parallelCurrency: 'USD',
  funds: [
    {
      itemId: itemId(10),
      account: fundsRef,
      client,
      currency: 'USD',
      amounts: { openMinor: '-50000', bookMinor: '-6000000', parallelMinor: '-50000' },
      receivable: false,
    },
    {
      itemId: itemId(11),
      account: fundsRef,
      client: otherClient,
      currency: 'USD',
      amounts: { openMinor: '10000', bookMinor: '1200000', parallelMinor: '10000' },
      receivable: true,
    },
  ],
  heldMinor: '-6000000',
  receivableMinor: '1200000',
};

/** `GET /api/open-items`: the items filtered by account, client, state and reference text. */
export function itemsPage(url: URL) {
  const params = url.searchParams;
  const items = [m0, m1, hubItem].filter(
    (item) =>
      (!params.get('account') || item.account.id === params.get('account')) &&
      (!params.get('client') || item.client?.id === params.get('client')) &&
      (!params.get('text') || item.reference.includes(params.get('text') ?? '')),
  );
  return { items, nextCursor: null };
}

/** Every read of the receivables screens and the entry screen, answered. */
export const receivablesReads = {
  ...entryReads,
  'GET /api/receivables/ageing': { status: 200, json: ageing },
  'GET /api/open-items': (request: { url(): string }) => ({
    status: 200,
    json: itemsPage(new URL(request.url())),
  }),
  [`GET /api/open-items/${m1.id}`]: { status: 200, json: m1Item },
  [`GET /api/open-items/${hubItem.id}`]: { status: 200, json: hubOpenItem },
  [`GET /api/clients/${client.id}/statement`]: { status: 200, json: statement },
  'GET /api/client-funds': { status: 200, json: clientFunds },
};
