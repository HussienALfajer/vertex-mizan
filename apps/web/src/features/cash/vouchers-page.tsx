import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import {
  VOUCHER_KINDS,
  VOUCHER_STATES,
  type VoucherKind,
  type VoucherState,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  Amount,
  Button,
  Card,
  type DateRange,
  DateRangeField,
  EmptyState,
  isDateRangeOrdered,
  PageHeader,
  SelectField,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { BanIcon, ReceiptIcon } from 'lucide-react';
import { FormError } from '../../components/form-error';
import { formatDay } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { useFiscalYearStartMonth } from '../entries/entry-parts';
import { PrintVoucherButton, VoucherNumberText, VoucherStateBadge } from './cash-parts';
import { cashPositionQuery, vouchersQuery } from './cash-queries';
import { CashBackLink } from './cash-statement-page';

const t = ar.cash.register;
const route = getRouteApi('/_app/_company/cash/vouchers/');

const ALL = 'all';

/**
 * `/cash/vouchers` (S11 "Screens"): the vouchers by date, newest first, filtered by kind, cash
 * account and state in the address; each opens its page, prints, and shows the reversal that
 * cancelled it.
 */
export function VouchersPage() {
  const search = route.useSearch();
  const navigate = useNavigate();
  const { companyId } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const range: DateRange = { from: search.from ?? '', to: search.to ?? '' };
  const filters = {
    kind: search.kind,
    cashAccount: search.account,
    state: search.state,
    from: search.from,
    to: search.to,
  };
  const { me, membership } = useCompany();
  const cancels = !membership.company.archived && can(me, 'drafts.manage');
  const pages = useInfiniteQuery({
    ...vouchersQuery(companyId, filters),
    enabled: isDateRangeOrdered(range),
  });
  const position = useQuery(cashPositionQuery(companyId, undefined));
  const accounts = (position.data?.groups ?? []).flatMap((group) => group.accounts);
  const vouchers = pages.data?.pages.flatMap((page) => page.vouchers) ?? [];
  const set = (next: Partial<typeof search>) =>
    void navigate({ to: '/cash/vouchers', search: { ...search, ...next }, replace: true });
  return (
    <>
      <PageHeader back={<CashBackLink />} title={t.title} />
      <Card className="p-4">
        <search aria-label={t.filters} className="grid gap-4 md:grid-cols-3">
          <DateRangeField
            value={range}
            onValueChange={(next) =>
              set({ from: next.from || undefined, to: next.to || undefined })
            }
            label={t.range}
            fromLabel={ar.reports.header.from}
            toLabel={ar.reports.header.to}
            orderError={ar.cash.statement.rangeError}
            className="md:col-span-3"
          />
          <SelectField
            label={t.kind}
            value={search.kind ?? ALL}
            options={[
              { value: ALL, label: t.allKinds },
              ...VOUCHER_KINDS.map((kind) => ({ value: kind, label: ar.cash.kinds[kind] })),
            ]}
            onValueChange={(value) =>
              set({ kind: value === ALL ? undefined : (value as VoucherKind) })
            }
          />
          <SelectField
            label={t.account}
            value={search.account ?? ALL}
            options={[
              { value: ALL, label: t.allAccounts },
              ...accounts.map((account) => ({
                value: account.id,
                label: `${account.code} ${account.name}`,
              })),
            ]}
            onValueChange={(value) => set({ account: value === ALL ? undefined : value })}
          />
          <SelectField
            label={t.state}
            value={search.state ?? ALL}
            options={[
              { value: ALL, label: t.allStates },
              ...VOUCHER_STATES.map((state) => ({ value: state, label: ar.cash.states[state] })),
            ]}
            onValueChange={(value) =>
              set({ state: value === ALL ? undefined : (value as VoucherState) })
            }
          />
        </search>
      </Card>
      {pages.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
        </div>
      ) : pages.isError ? (
        <FormError error={pages.error} />
      ) : vouchers.length === 0 ? (
        <EmptyState icon={<ReceiptIcon />} title={t.empty} />
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <Table aria-label={t.title}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.columns.number}</TableHead>
                <TableHead>{t.columns.date}</TableHead>
                <TableHead>{t.columns.account}</TableHead>
                <TableHead>{t.columns.party}</TableHead>
                <TableHead numeric>{t.columns.amount}</TableHead>
                <TableHead>{t.columns.state}</TableHead>
                <TableHead>
                  <span className="sr-only">{t.print}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vouchers.map((voucher) => (
                <TableRow key={voucher.id}>
                  <TableCell>
                    <Link
                      to="/cash/vouchers/$id"
                      params={{ id: voucher.id }}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      <VoucherNumberText voucher={voucher} startMonth={startMonth} />
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDay(voucher.date)}</TableCell>
                  <TableCell>
                    <span className="flex flex-col gap-0.5">
                      <AccountLabel
                        code={voucher.cashAccount.code}
                        name={voucher.cashAccount.name}
                      />
                      {voucher.counterCashAccount && (
                        <AccountLabel
                          code={voucher.counterCashAccount.code}
                          name={voucher.counterCashAccount.name}
                          className="text-xs text-muted-foreground"
                        />
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-col gap-0.5">
                      {voucher.partyName && <bdi>{voucher.partyName}</bdi>}
                      <bdi className="max-w-64 truncate text-xs text-muted-foreground">
                        {voucher.description}
                      </bdi>
                    </span>
                  </TableCell>
                  <TableCell numeric>
                    <Amount
                      value={BigInt(voucher.amount.amountMinor)}
                      currency={voucher.amount.currency}
                      showCurrency
                    />
                  </TableCell>
                  <TableCell>
                    <VoucherStateBadge state={voucher.state} />
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2">
                      <PrintVoucherButton voucherId={voucher.id} size="sm" />
                      {cancels && voucher.state === 'posted' && voucher.entry !== null && (
                        <Button
                          variant="ghost"
                          size="sm"
                          render={
                            <Link
                              to="/cash/vouchers/$id"
                              params={{ id: voucher.id }}
                              search={{ cancel: true }}
                            />
                          }
                        >
                          <BanIcon aria-hidden="true" />
                          {t.cancel}
                        </Button>
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {pages.hasNextPage && (
            <Button
              variant="outline"
              className="w-fit"
              loading={pages.isFetchingNextPage}
              onClick={() => void pages.fetchNextPage()}
            >
              {t.more}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
