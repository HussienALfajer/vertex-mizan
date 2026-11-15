import type {
  CashAccountRef,
  CashKind,
  CashPosition,
  CashStatement,
  CashStatementQuery,
  CashStatementRow,
  CurrencyCode,
  VoucherKind,
  VoucherQuery,
  VoucherState,
} from '@vertex-mizan/contracts';
import { DomainError } from '@vertex-mizan/contracts';
import { dayBefore, periodOf } from '@vertex-mizan/ledger';
import { type SQL, sql } from 'drizzle-orm';
import type { Transaction } from '../client.js';
import { companySettings } from '../schema/companies.js';
import { ledgersOf } from './companies.js';

// The cash screens' reads (S11 rules 16–17, "Reports"): the cash position at a date, a cash
// account's statement and the vouchers' register, shared by the API and (S11 PR 3) the worker's
// prints. Every figure is summed in SQL, never here: the period balances of the months before the
// date's and the lines of its month, as the trial balance reads them (S09).

const COUNTERPARTY_TYPE_CODES = sql`('client', 'supplier', 'worker')`;

/** The company's ledger currencies. */
async function currenciesOf(tx: Transaction) {
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  const ledgers = ledgersOf(settings);
  return { book: ledgers.book.currency, parallel: ledgers.parallel?.currency ?? null };
}

/**
 * Each account's balance at the end of `asOf`: its transaction, book and parallel amounts, from
 * the period balances of the months before `asOf`'s and the lines of its month up to `asOf`.
 */
function balancesAt(asOf: string): SQL {
  const month = periodOf(asOf);
  return sql`
    select t.account_id, sum(t.amount) as amount, sum(t.book) as book, sum(t.parallel) as parallel
    from (
      select b.account_id, b.debit_minor - b.credit_minor as amount,
        b.book_debit_minor - b.book_credit_minor as book,
        b.parallel_debit_minor - b.parallel_credit_minor as parallel
      from public.period_balances b
      join public.periods p on p.company_id = b.company_id and p.id = b.period_id
      where p.period < ${month}
      union all
      select l.account_id, l.amount_minor, l.book_minor, l.parallel_minor
      from public.journal_lines l
      join public.journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
      where e.entry_date >= ${`${month}-01`}::date and e.entry_date <= ${asOf}::date
    ) t
    group by t.account_id`;
}

type AccountRow = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly name_latin: string | null;
  readonly cash_kind: CashKind;
  readonly currency: CurrencyCode;
};

const refOf = (row: AccountRow): CashAccountRef => ({
  id: row.id,
  code: row.code,
  name: row.name,
  nameLatin: row.name_latin,
  cashKind: row.cash_kind,
  currency: row.currency,
});

/**
 * The cash position at the end of `asOf` (S11 rule 16): every unarchived cash account with its
 * balance in its currency and its carrying amounts in each ledger, grouped by currency in code
 * order, with the totals of each group and of each ledger.
 */
export async function readCashPosition(tx: Transaction, asOf: string): Promise<CashPosition> {
  const currencies = await currenciesOf(tx);
  const accounts = await tx.execute<
    AccountRow & { amount: string; book: string; parallel: string | null }
  >(sql`
    select a.id, a.code, a.name, a.name_latin, a.cash_kind, a.currency,
      coalesce(s.amount, 0)::text as amount, coalesce(s.book, 0)::text as book,
      coalesce(s.parallel, 0)::text as parallel
    from public.chart_accounts a
    left join (${balancesAt(asOf)}) s on s.account_id = a.id
    where a.cash_kind is not null and a.archived_at is null
    order by a.currency, a.code`);
  const totals = await tx.execute<{
    currency: string | null;
    amount: string;
    book: string;
    parallel: string;
  }>(sql`
    select a.currency, coalesce(sum(s.amount), 0)::text as amount,
      coalesce(sum(s.book), 0)::text as book, coalesce(sum(s.parallel), 0)::text as parallel
    from public.chart_accounts a
    left join (${balancesAt(asOf)}) s on s.account_id = a.id
    where a.cash_kind is not null and a.archived_at is null
    group by rollup (a.currency)`);
  const parallelOf = (amountMinor: string | null) =>
    currencies.parallel === null
      ? null
      : { amountMinor: amountMinor ?? '0', currency: currencies.parallel };
  const groups = [...new Set(accounts.rows.map((row) => row.currency))].map((currency) => {
    const total = totals.rows.find((row) => row.currency === currency);
    return {
      currency,
      accounts: accounts.rows
        .filter((row) => row.currency === currency)
        .map((row) => ({
          ...refOf(row),
          balance: { amountMinor: row.amount, currency },
          book: { amountMinor: row.book, currency: currencies.book },
          parallel: parallelOf(row.parallel),
        })),
      total: { amountMinor: total?.amount ?? '0', currency },
      book: { amountMinor: total?.book ?? '0', currency: currencies.book },
      parallel: parallelOf(total?.parallel ?? '0'),
    };
  });
  const all = totals.rows.find((row) => row.currency === null);
  return {
    asOf,
    bookCurrency: currencies.book,
    parallelCurrency: currencies.parallel,
    groups,
    book: { amountMinor: all?.book ?? '0', currency: currencies.book },
    parallel: parallelOf(all?.parallel ?? '0'),
  };
}

/** A cash account of the company, or `NOT_FOUND` (another company's or not a cash account). */
export async function readCashAccount(tx: Transaction, id: string): Promise<CashAccountRef> {
  const result = await tx.execute<AccountRow>(sql`
    select a.id, a.code, a.name, a.name_latin, a.cash_kind, a.currency
    from public.chart_accounts a
    where a.id = ${id} and a.cash_kind is not null`);
  const [row] = result.rows;
  if (row === undefined) throw new DomainError('NOT_FOUND', 'No such cash account');
  return refOf(row);
}

/**
 * A cash account's statement for a range (S11 rule 17): the opening balance at the end of the day
 * before `from`; each line on the account in date, then entry order, with its voucher, its counter
 * account (none when the other lines span several: "متعدد"), the counterparty and contract of a
 * single counter line, in, out and the running balance in the account's currency, and its book and
 * parallel amounts when asked; each count with no entry as a row of its own with its amounts; the
 * totals and the closing balance, which is the account's balance at `to`.
 */
export async function readCashStatement(
  tx: Transaction,
  id: string,
  query: CashStatementQuery,
): Promise<CashStatement> {
  const account = await readCashAccount(tx, id);
  const currencies = await currenciesOf(tx);
  const ledgers = query.ledgers.filter(
    (ledger) => ledger === 'book' || currencies.parallel !== null,
  );
  const before = dayBefore(query.from);
  const balanceOf = async (asOf: string) => {
    const result = await tx.execute<{ amount: string; book: string; parallel: string }>(sql`
      select coalesce(s.amount, 0)::text as amount, coalesce(s.book, 0)::text as book,
        coalesce(s.parallel, 0)::text as parallel
      from (select 1) one
      left join (${balancesAt(asOf)}) s on s.account_id = ${id}`);
    const row = result.rows[0] ?? { amount: '0', book: '0', parallel: '0' };
    return {
      amount: { amountMinor: row.amount, currency: account.currency },
      book: ledgers.includes('book') ? { amountMinor: row.book, currency: currencies.book } : null,
      parallel:
        ledgers.includes('parallel') && currencies.parallel !== null
          ? { amountMinor: row.parallel, currency: currencies.parallel }
          : null,
    };
  };
  const opening = await balanceOf(before);
  const rows = await tx.execute<{
    kind: 'line' | 'count';
    date: string;
    entry_id: string | null;
    fiscal_year: number | null;
    number: number | null;
    line_no: number | null;
    voucher_id: string | null;
    voucher_kind: VoucherKind | null;
    voucher_year: number | null;
    voucher_number: number | null;
    description: string;
    counter_id: string | null;
    counter_code: string | null;
    counter_name: string | null;
    counter_count: number;
    party_id: string | null;
    party_code: string | null;
    party_name: string | null;
    contract_id: string | null;
    contract_code: string | null;
    contract_name: string | null;
    amount_in: string;
    amount_out: string;
    balance: string;
    book: string | null;
    parallel: string | null;
    expected_minor: string | null;
    counted_minor: string | null;
  }>(sql`
    with moves as (
      select 'line' as kind, e.entry_date as date, e.id as entry_id, e.fiscal_year, e.number,
        l.line_no, l.amount_minor as amount, l.book_minor as book, l.parallel_minor as parallel,
        e.description, v.id as voucher_id, v.kind as voucher_kind, v.fiscal_year as voucher_year,
        v.number as voucher_number, v.expected_minor, v.counted_minor
      from public.journal_lines l
      join public.journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
      left join public.cash_vouchers v on v.company_id = e.company_id and v.entry_id = e.id
      where l.account_id = ${id} and e.entry_date between ${query.from}::date and ${query.to}::date
      union all
      select 'count', v.voucher_date, null, null, null, null, 0, 0, 0, d.description, v.id, v.kind,
        v.fiscal_year, v.number, v.expected_minor, v.counted_minor
      from public.cash_vouchers v
      join public.entry_drafts d on d.company_id = v.company_id and d.id = v.draft_id
      where v.cash_account_id = ${id} and v.entry_id is null
        and v.voucher_date between ${query.from}::date and ${query.to}::date
    )
    select m.kind, m.date::text as date, m.entry_id, m.fiscal_year, m.number, m.line_no,
      m.voucher_id, m.voucher_kind, m.voucher_year, m.voucher_number,
      coalesce(m.description, '') as description,
      c.account_id as counter_id, ca.code as counter_code, ca.name as counter_name,
      coalesce(c.n, 0)::int as counter_count,
      cp.id as party_id, cp.code as party_code, cp.name as party_name,
      ct.id as contract_id, ct.code as contract_code, ct.name as contract_name,
      greatest(m.amount, 0)::text as amount_in, greatest(-m.amount, 0)::text as amount_out,
      (${opening.amount.amountMinor}::bigint + sum(m.amount) over (
        order by m.date, m.kind desc, m.fiscal_year, m.number, m.line_no, m.voucher_id
        rows between unbounded preceding and current row))::text as balance,
      m.book::text as book, m.parallel::text as parallel,
      m.expected_minor::text as expected_minor, m.counted_minor::text as counted_minor
    from moves m
    left join lateral (
      select count(distinct o.account_id) as n,
        (array_agg(o.account_id order by o.line_no))[1] as account_id,
        (array_agg(o.dimension_set_id order by o.line_no))[1] as set_id
      from public.journal_lines o
      where o.entry_id = m.entry_id and o.account_id <> ${id}
        and o.kind not in ('difference', 'rounding')
    ) c on m.entry_id is not null
    left join public.chart_accounts ca on ca.id = c.account_id and c.n = 1
    left join lateral (
      select dv.id, dv.code, dv.name
      from public.dimension_set_values sv
      join public.dimension_types t on t.company_id = sv.company_id and t.id = sv.type_id
      join public.dimension_values dv on dv.company_id = sv.company_id and dv.id = sv.value_id
      where sv.set_id = c.set_id and t.code in ${COUNTERPARTY_TYPE_CODES}
      limit 1
    ) cp on c.n = 1
    left join lateral (
      select dv.id, dv.code, dv.name
      from public.dimension_set_values sv
      join public.dimension_types t on t.company_id = sv.company_id and t.id = sv.type_id
      join public.dimension_values dv on dv.company_id = sv.company_id and dv.id = sv.value_id
      where sv.set_id = c.set_id and t.code = 'contract'
      limit 1
    ) ct on c.n = 1
    order by m.date, m.kind desc, m.fiscal_year, m.number, m.line_no, m.voucher_id`);
  const totals = await tx.execute<{ total_in: string; total_out: string }>(sql`
    select coalesce(sum(greatest(l.amount_minor, 0)), 0)::text as total_in,
      coalesce(sum(greatest(-l.amount_minor, 0)), 0)::text as total_out
    from public.journal_lines l
    join public.journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
    where l.account_id = ${id} and e.entry_date between ${query.from}::date and ${query.to}::date`);
  const ref = (rowId: string | null, code: string | null, name: string | null) =>
    rowId === null ? null : { id: rowId, code, name: name ?? '' };
  return {
    account,
    from: query.from,
    to: query.to,
    ledgers,
    bookCurrency: currencies.book,
    parallelCurrency: currencies.parallel,
    opening,
    rows: rows.rows.map(
      (row): CashStatementRow => ({
        kind: row.kind,
        date: row.date,
        entry:
          row.entry_id === null
            ? null
            : {
                id: row.entry_id,
                fiscalYear: Number(row.fiscal_year),
                number: Number(row.number),
                lineNo: Number(row.line_no),
              },
        voucher:
          row.voucher_id === null || row.voucher_kind === null
            ? null
            : {
                id: row.voucher_id,
                kind: row.voucher_kind,
                fiscalYear: Number(row.voucher_year),
                number: Number(row.voucher_number),
              },
        description: row.description,
        counterAccount:
          row.counter_id === null || row.counter_code === null
            ? null
            : { id: row.counter_id, code: row.counter_code, name: row.counter_name ?? '' },
        severalCounterAccounts: row.counter_count > 1,
        counterparty: ref(row.party_id, row.party_code, row.party_name),
        contract: ref(row.contract_id, row.contract_code, row.contract_name),
        in: row.amount_in,
        out: row.amount_out,
        balance: row.balance,
        book: ledgers.includes('book') ? row.book : null,
        parallel: ledgers.includes('parallel') ? row.parallel : null,
        expectedMinor: row.expected_minor,
        countedMinor: row.counted_minor,
      }),
    ),
    totalIn: totals.rows[0]?.total_in ?? '0',
    totalOut: totals.rows[0]?.total_out ?? '0',
    closing: await balanceOf(query.to),
  };
}

/** A voucher row as the register and the voucher's page read it (S11 "API"). */
export interface VoucherRow {
  readonly id: string;
  readonly kind: VoucherKind;
  readonly fiscalYear: number;
  readonly number: number;
  readonly date: string;
  readonly state: VoucherState;
  readonly cashAccount: CashAccountRef;
  readonly counterCashAccount: CashAccountRef | null;
  readonly amountMinor: string;
  readonly partyName: string | null;
  readonly description: string;
  readonly entry: { id: string; fiscalYear: number; number: number } | null;
  readonly reversal: { id: string; fiscalYear: number; number: number } | null;
  readonly expectedMinor: string | null;
  readonly countedMinor: string | null;
  readonly draftId: string;
  readonly preparedByUserId: string | null;
  readonly approvedByUserId: string | null;
  readonly createdAt: string;
}

/**
 * The vouchers' register (S11 "API"), by voucher date newest first, `size + 1` rows after the
 * cursor's voucher, filtered by kind, cash account (as source or destination), range and state:
 * `cancelled` when its entry is reversed (rule 14). Its amount is the cash account's movement in
 * its currency, as a magnitude; a count that matched moves nothing. One voucher by `id` when given.
 */
export async function readVoucherRows(
  tx: Transaction,
  query: Omit<VoucherQuery, 'cursor'> & { readonly after?: string; readonly id?: string },
  size: number,
): Promise<VoucherRow[]> {
  const where: SQL[] = [sql`true`];
  if (query.id !== undefined) where.push(sql`v.id = ${query.id}`);
  if (query.kind !== undefined) where.push(sql`v.kind = ${query.kind}`);
  if (query.cashAccount !== undefined) {
    where.push(
      sql`(v.cash_account_id = ${query.cashAccount} or v.counter_cash_account_id = ${query.cashAccount})`,
    );
  }
  if (query.from !== undefined) where.push(sql`v.voucher_date >= ${query.from}::date`);
  if (query.to !== undefined) where.push(sql`v.voucher_date <= ${query.to}::date`);
  if (query.state === 'cancelled') where.push(sql`r.id is not null`);
  if (query.state === 'posted') where.push(sql`r.id is null`);
  if (query.after !== undefined) {
    where.push(sql`(v.voucher_date, v.id) <
      (select c.voucher_date, c.id from public.cash_vouchers c where c.id = ${query.after})`);
  }
  const result = await tx.execute<{
    id: string;
    kind: VoucherKind;
    fiscal_year: number;
    number: number;
    date: string;
    cash_id: string;
    cash_code: string;
    cash_name: string;
    cash_name_latin: string | null;
    cash_kind: CashKind;
    cash_currency: CurrencyCode;
    counter_id: string | null;
    counter_code: string | null;
    counter_name: string | null;
    counter_name_latin: string | null;
    counter_kind: CashKind | null;
    counter_currency: CurrencyCode | null;
    amount: string;
    party_name: string | null;
    description: string;
    entry_id: string | null;
    entry_year: number | null;
    entry_number: number | null;
    reversal_id: string | null;
    reversal_year: number | null;
    reversal_number: number | null;
    expected_minor: string | null;
    counted_minor: string | null;
    draft_id: string;
    prepared_by: string | null;
    approved_by: string | null;
    created_at: string;
  }>(sql`
    select v.id, v.kind, v.fiscal_year, v.number, v.voucher_date::text as date,
      a.id as cash_id, a.code as cash_code, a.name as cash_name, a.name_latin as cash_name_latin,
      a.cash_kind, a.currency as cash_currency,
      b.id as counter_id, b.code as counter_code, b.name as counter_name,
      b.name_latin as counter_name_latin, b.cash_kind as counter_kind,
      b.currency as counter_currency,
      abs(coalesce((
        select sum(l.amount_minor) from public.journal_lines l
        where l.entry_id = v.entry_id and l.account_id = v.cash_account_id
      ), 0))::text as amount,
      v.party_name, coalesce(e.description, d.description, '') as description,
      e.id as entry_id, e.fiscal_year as entry_year, e.number as entry_number,
      r.id as reversal_id, r.fiscal_year as reversal_year, r.number as reversal_number,
      v.expected_minor::text as expected_minor, v.counted_minor::text as counted_minor,
      v.draft_id, coalesce(e.prepared_by_user_id, d.prepared_by_user_id) as prepared_by,
      e.approved_by_user_id as approved_by,
      to_char(v.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
    from public.cash_vouchers v
    join public.chart_accounts a on a.company_id = v.company_id and a.id = v.cash_account_id
    left join public.chart_accounts b
      on b.company_id = v.company_id and b.id = v.counter_cash_account_id
    join public.entry_drafts d on d.company_id = v.company_id and d.id = v.draft_id
    left join public.journal_entries e on e.company_id = v.company_id and e.id = v.entry_id
    left join public.journal_entries r
      on r.company_id = v.company_id and r.reverses_entry_id = v.entry_id
    where ${sql.join(where, sql` and `)}
    order by v.voucher_date desc, v.id desc
    limit ${size + 1}`);
  const link = (id: string | null, year: number | null, number: number | null) =>
    id === null ? null : { id, fiscalYear: Number(year), number: Number(number) };
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    fiscalYear: Number(row.fiscal_year),
    number: Number(row.number),
    date: row.date,
    state: row.reversal_id === null ? 'posted' : 'cancelled',
    cashAccount: {
      id: row.cash_id,
      code: row.cash_code,
      name: row.cash_name,
      nameLatin: row.cash_name_latin,
      cashKind: row.cash_kind,
      currency: row.cash_currency,
    },
    counterCashAccount:
      row.counter_id === null || row.counter_kind === null || row.counter_currency === null
        ? null
        : {
            id: row.counter_id,
            code: row.counter_code ?? '',
            name: row.counter_name ?? '',
            nameLatin: row.counter_name_latin,
            cashKind: row.counter_kind,
            currency: row.counter_currency,
          },
    amountMinor: row.amount,
    partyName: row.party_name,
    description: row.description,
    entry: link(row.entry_id, row.entry_year, row.entry_number),
    reversal: link(row.reversal_id, row.reversal_year, row.reversal_number),
    expectedMinor: row.expected_minor,
    countedMinor: row.counted_minor,
    draftId: row.draft_id,
    preparedByUserId: row.prepared_by,
    approvedByUserId: row.approved_by,
    createdAt: row.created_at,
  }));
}
