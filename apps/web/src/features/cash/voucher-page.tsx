import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  Amount,
  Button,
  Callout,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  VoucherHeader,
} from '@vertex-mizan/ui';
import { BanIcon, FileQuestionIcon, InfoIcon } from 'lucide-react';
import { useState } from 'react';
import { FormError } from '../../components/form-error';
import { hasCode } from '../../lib/api';
import { formatEntryNumber } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { companyQuery } from '../company/company-queries';
import { ReverseDialog } from '../entries/entry-page';
import {
  EntryLinesTable,
  EntryNumberText,
  Fact,
  useFiscalYearStartMonth,
} from '../entries/entry-parts';
import { useDimensionCatalog } from '../entries/entry-queries';
import { PrintVoucherButton, voucherNumberText } from './cash-parts';
import { voucherQuery } from './cash-queries';
import { CashBackLink } from './cash-statement-page';

const t = ar.cash.voucher;
const route = getRouteApi('/_app/_company/cash/vouchers/$id');

/**
 * `/cash/vouchers/:id` (S11 "Screens"): a voucher's header (`VoucherHeader`: kind, number, date,
 * state), its cash accounts, amount, party and description, its entry with both ledgers, who
 * prepared and approved it, the print, and the cancellation, which reverses its entry (rule 14):
 * the voucher keeps its number and prints "ملغى" with the reversal's number. A count that matched
 * has no entry and cannot be cancelled.
 */
export function VoucherPage() {
  const { id } = route.useParams();
  const { companyId, me, membership } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const company = useQuery(companyQuery(companyId));
  const catalog = useDimensionCatalog(companyId);
  const voucher = useQuery(voucherQuery(companyId, id));
  const [cancelling, setCancelling] = useState(false);

  if (voucher.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (voucher.isError) {
    return hasCode(voucher.error, 'NOT_FOUND') || hasCode(voucher.error, 'VALIDATION_FAILED') ? (
      <>
        <CashBackLink />
        <EmptyState icon={<FileQuestionIcon />} title={ar.cash.register.empty} />
      </>
    ) : (
      <FormError error={voucher.error} />
    );
  }
  const data = voucher.data;
  const number = voucherNumberText(data, startMonth);
  const kind = ar.cash.kinds[data.kind];
  const entry = data.entryDetail;
  const cancellable =
    entry !== null &&
    data.state === 'posted' &&
    !membership.company.archived &&
    can(me, 'drafts.manage');
  return (
    <>
      <PageHeader
        back={<CashBackLink />}
        title={t.title.replace('{kind}', kind).replace('{number}', number)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PrintVoucherButton voucherId={data.id} />
            {cancellable && (
              <Button variant="outline" onClick={() => setCancelling(true)}>
                <BanIcon aria-hidden="true" />
                {ar.cash.register.cancel}
              </Button>
            )}
          </div>
        }
      />
      <VoucherHeader
        kind={kind}
        number={number}
        date={data.date}
        labels={ar.cash.form}
        state={
          data.state === 'cancelled'
            ? { label: ar.cash.states.cancelled, tone: 'danger' }
            : { label: ar.cash.states.posted, tone: 'success' }
        }
      >
        <dl className="contents">
          <Fact label={data.counterCashAccount ? ar.cash.form.source : ar.cash.form.cashAccount}>
            <AccountLabel code={data.cashAccount.code} name={data.cashAccount.name} />
          </Fact>
          {data.counterCashAccount && (
            <Fact label={ar.cash.form.destination}>
              <AccountLabel
                code={data.counterCashAccount.code}
                name={data.counterCashAccount.name}
              />
            </Fact>
          )}
          <Fact label={data.kind === 'count' ? ar.cash.form.counted : ar.cash.form.amount}>
            <Amount
              value={BigInt(
                data.kind === 'count' ? (data.countedMinor ?? '0') : data.amount.amountMinor,
              )}
              currency={data.amount.currency}
              showCurrency
              strong
            />
          </Fact>
          {data.kind === 'count' && data.expectedMinor !== null && (
            <Fact label={ar.cash.form.expected}>
              <Amount
                value={BigInt(data.expectedMinor)}
                currency={data.amount.currency}
                showCurrency
              />
            </Fact>
          )}
          {data.partyName && (
            <Fact
              label={
                data.kind === 'receipt' ? ar.cash.form.partyReceipt : ar.cash.form.partyPayment
              }
            >
              <bdi>{data.partyName}</bdi>
            </Fact>
          )}
          <Fact label={data.kind === 'count' ? ar.cash.form.reason : ar.cash.form.description}>
            <bdi>{data.description}</bdi>
          </Fact>
          {data.entry && (
            <Fact label={t.entry}>
              <Link
                to="/entries/$id"
                params={{ id: data.entry.id }}
                className="text-primary underline-offset-4 hover:underline"
              >
                <EntryNumberText number={data.entry} startMonth={startMonth} />
              </Link>
            </Fact>
          )}
          {data.reversal && (
            <Fact label={t.reversal}>
              <Link
                to="/entries/$id"
                params={{ id: data.reversal.id }}
                className="text-primary underline-offset-4 hover:underline"
              >
                <EntryNumberText number={data.reversal} startMonth={startMonth} />
              </Link>
            </Fact>
          )}
          {data.preparedBy && (
            <Fact label={t.preparedBy}>
              <bdi>{data.preparedBy.name}</bdi>
            </Fact>
          )}
          {data.approvedBy && (
            <Fact label={t.approvedBy}>
              <bdi>{data.approvedBy.name}</bdi>
            </Fact>
          )}
        </dl>
      </VoucherHeader>
      {entry === null ? (
        <Callout tone="info" icon={<InfoIcon />} title={t.noEntry} />
      ) : (
        <Card className="min-w-0 p-4">
          <EntryLinesTable
            label={`${t.entry} ${formatEntryNumber(entry, startMonth)}`}
            lines={entry.lines}
            bookCurrency={entry.bookCurrency}
            parallelCurrency={entry.parallelCurrency}
            dimensions={catalog.byId}
          />
        </Card>
      )}
      {cancelling && entry && (
        <ReverseDialog
          entry={entry}
          number={formatEntryNumber(entry, startMonth)}
          approval={company.data?.manualEntryApproval ?? false}
          onClose={() => setCancelling(false)}
        />
      )}
    </>
  );
}
