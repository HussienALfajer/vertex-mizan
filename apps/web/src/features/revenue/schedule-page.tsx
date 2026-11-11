import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import type { RecognitionAmounts, RevenueScheduleDetail } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { FileQuestionIcon, InboxIcon, ReceiptTextIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { FormError } from '../../components/form-error';
import { hasCode } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { EntryNumberText, Fact, useFiscalYearStartMonth } from '../entries/entry-parts';
import { openItemsQuery } from '../receivables/receivables-queries';
import {
  formatMonth,
  LedgerAmount,
  movementLabel,
  PeriodText,
  RevenueBackLink,
  ScheduleStateBadge,
  useLedgerCurrencies,
  ValueName,
} from './revenue-parts';
import { revenueScheduleQuery } from './revenue-queries';

const t = ar.revenue.schedule;
const route = getRouteApi('/_app/_company/revenue/$id');

/**
 * `/revenue/:id` (S06 "Screens"): a schedule with its invoice and event, its line, pattern and
 * service history; each month's planned part and its posted release in both ledgers; and every
 * movement (the deferral, elapsed parts, releases, credits, voids, re-issues and a cancelled
 * project's split) with its entry.
 */
export function SchedulePage() {
  const { id } = route.useParams();
  const { companyId, me } = useCompany();
  const schedule = useQuery(revenueScheduleQuery(companyId, id));
  if (hasCode(schedule.error, 'NOT_FOUND') || hasCode(schedule.error, 'VALIDATION_FAILED')) {
    return (
      <>
        <RevenueBackLink />
        <EmptyState icon={<FileQuestionIcon />} title={t.notFound} />
      </>
    );
  }
  if (schedule.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-control w-64" />
        <Skeleton className="h-row" />
        <Skeleton className="h-row" />
      </div>
    );
  }
  if (schedule.isError) return <FormError error={schedule.error} />;
  const data = schedule.data;
  return (
    <>
      <PageHeader
        back={<RevenueBackLink />}
        title={
          <span className="flex flex-wrap items-center gap-x-3">
            {t.title}
            <bdi dir="ltr">{data.invoiceNumber}</bdi>
          </span>
        }
        description={ar.revenue.patterns[data.pattern]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ScheduleStateBadge state={data.state} />
            {can(me, 'events.read') && (
              <Button
                variant="outline"
                render={<Link to="/inbox/$id" params={{ id: data.inboxId }} />}
              >
                <InboxIcon aria-hidden="true" />
                {t.openEvent}
              </Button>
            )}
            {can(me, 'open_items.read') && <InvoiceItemLink schedule={data} />}
          </div>
        }
      />
      <Card className="p-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t.invoice}>
            <bdi dir="ltr">{data.invoiceNumber}</bdi>
          </Fact>
          <Fact label={t.line}>
            {ar.revenue.lineSources[data.lineSource]}
            {data.chargeKind && (
              <span className="block text-xs text-muted-foreground">
                {ar.revenue.chargeKinds[data.chargeKind]}
              </span>
            )}
          </Fact>
          <Fact label={t.client}>
            <ValueName value={data.client} />
          </Fact>
          <Fact label={t.contract}>
            <ValueName value={data.contract} />
          </Fact>
          <Fact label={t.service}>
            <ValueName value={data.service} />
          </Fact>
          <Fact label={t.pattern}>{ar.revenue.patterns[data.pattern]}</Fact>
          <Fact label={data.milestoneId ? t.milestone : t.period}>
            <PeriodText schedule={data} />
          </Fact>
          <Fact label={t.amount}>
            <Amount value={BigInt(data.amountMinor)} currency={data.currency} showCurrency />
          </Fact>
          {data.reissueOfId && (
            <Fact label={t.reissueOf}>
              <Link
                to="/revenue/$id"
                params={{ id: data.reissueOfId }}
                className="text-primary underline-offset-4 hover:underline"
              >
                {t.openReissued}
              </Link>
            </Fact>
          )}
        </dl>
      </Card>
      <Totals schedule={data} />
      <Services schedule={data} />
      {data.months.length > 0 && <Months schedule={data} />}
      <Movements schedule={data} />
    </>
  );
}

/** The invoice's receivable item, found by its number, when it is in the books. */
function InvoiceItemLink({ schedule }: { schedule: RevenueScheduleDetail }) {
  const { companyId } = useCompany();
  const found = useQuery(
    openItemsQuery(companyId, { state: 'all', text: schedule.invoiceNumber }),
  ).data;
  const item = found?.items.find((candidate) => candidate.reference === schedule.invoiceNumber);
  if (!item) return null;
  return (
    <Button variant="outline" render={<Link to="/open-items/$id" params={{ id: item.id }} />}>
      <ReceiptTextIcon aria-hidden="true" />
      {t.openItem}
    </Button>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <h2 id={id} className="text-lg font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** What it released and still holds, in its currency and in both ledgers. */
function Totals({ schedule }: { schedule: RevenueScheduleDetail }) {
  const { companyId } = useCompany();
  const currencies = useLedgerCurrencies(companyId);
  const row = (label: string, amounts: RecognitionAmounts) => (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell numeric>
        <Amount value={BigInt(amounts.transactionMinor)} currency={schedule.currency} />
      </TableCell>
      <TableCell numeric>
        <LedgerAmount amounts={amounts} ledger="book" currencies={currencies} />
      </TableCell>
      {currencies.parallel && (
        <TableCell numeric>
          <LedgerAmount amounts={amounts} ledger="parallel" currencies={currencies} />
        </TableCell>
      )}
    </TableRow>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.amounts}</CardTitle>
      </CardHeader>
      <div className="min-w-0 px-6 pb-6">
        <Table aria-label={t.amounts}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.ledger}</TableHead>
              <TableHead numeric>
                {`${t.transaction} `}
                <bdi dir="ltr">{schedule.currency}</bdi>
              </TableHead>
              <TableHead numeric>
                {`${t.book} `}
                <bdi dir="ltr">{currencies.book}</bdi>
              </TableHead>
              {currencies.parallel && (
                <TableHead numeric>
                  {`${t.parallel} `}
                  <bdi dir="ltr">{currencies.parallel}</bdi>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {row(t.released, schedule.released)}
            {row(t.remaining, schedule.remaining)}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

/** The service at issue, then each change of it (S06 rule 10). */
function Services({ schedule }: { schedule: RevenueScheduleDetail }) {
  const changes = schedule.movements.filter(
    (movement) => movement.kind === 'reclassified' && movement.service !== null,
  );
  if (changes.length === 0) return null;
  return (
    <Section id="schedule-services" title={t.servicesTitle}>
      <ul className="flex flex-col gap-1">
        {changes.map((movement) => (
          <li key={movement.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-muted-foreground">
              {movement.entry
                ? formatDay(movement.entry.date)
                : formatDay(movement.createdAt.slice(0, 10))}
            </span>
            <span>{t.serviceChanged}</span>
            <ValueName value={movement.service} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Each month's days, its part and whether it was released or elapsed at issue. */
function Months({ schedule }: { schedule: RevenueScheduleDetail }) {
  const { companyId } = useCompany();
  const currencies = useLedgerCurrencies(companyId);
  return (
    <Section id="schedule-months" title={t.monthsTitle}>
      <Table aria-label={t.monthsLabel}>
        <TableHeader>
          <TableRow>
            <TableHead>{ar.revenue.months.month}</TableHead>
            <TableHead numeric className="max-sm:hidden">
              {t.days}
            </TableHead>
            <TableHead numeric>{t.part}</TableHead>
            <TableHead numeric className="max-md:hidden">
              {t.book}
            </TableHead>
            {currencies.parallel && (
              <TableHead numeric className="max-md:hidden">
                {t.parallel}
              </TableHead>
            )}
            <TableHead>{t.monthState}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {schedule.months.map((month) => (
            <TableRow key={month.month}>
              <TableCell>{formatMonth(month.month)}</TableCell>
              <TableCell numeric className="max-sm:hidden">
                <bdi dir="ltr">{month.days}</bdi>
              </TableCell>
              <TableCell numeric>
                <Amount value={BigInt(month.part.transactionMinor)} currency={schedule.currency} />
              </TableCell>
              <TableCell numeric className="max-md:hidden">
                <LedgerAmount amounts={month.part} ledger="book" currencies={currencies} />
              </TableCell>
              {currencies.parallel && (
                <TableCell numeric className="max-md:hidden">
                  <LedgerAmount amounts={month.part} ledger="parallel" currencies={currencies} />
                </TableCell>
              )}
              <TableCell>
                {month.elapsed ? (
                  <Badge tone="gold" className="w-fit">
                    {t.monthElapsed}
                  </Badge>
                ) : month.released ? (
                  <Badge tone="success" className="w-fit">
                    {t.monthReleased}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">{t.monthPlanned}</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

/** Every movement with its entry: what it added to or took from what is still to recognise. */
function Movements({ schedule }: { schedule: RevenueScheduleDetail }) {
  const { companyId, me } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const currencies = useLedgerCurrencies(companyId);
  const entries = can(me, 'entries.read');
  return (
    <Section id="schedule-movements" title={t.movementsTitle}>
      <Table aria-label={t.movementsLabel}>
        <TableHeader>
          <TableRow>
            <TableHead>{t.kind}</TableHead>
            <TableHead>{t.entry}</TableHead>
            <TableHead className="max-sm:hidden">{t.date}</TableHead>
            <TableHead numeric>{t.part}</TableHead>
            <TableHead numeric className="max-md:hidden">
              {t.book}
            </TableHead>
            {currencies.parallel && (
              <TableHead numeric className="max-md:hidden">
                {t.parallel}
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {schedule.movements.map((movement) => (
            <TableRow key={movement.id}>
              <TableCell>
                <span className="flex flex-col gap-0.5">
                  {movementLabel(movement.kind)}
                  {movement.month && (
                    <span className="text-xs text-muted-foreground">
                      {formatMonth(movement.month)}
                    </span>
                  )}
                  {movement.creditMinor !== null && (
                    <span className="text-xs text-muted-foreground">
                      {`${t.creditPart}: `}
                      <Amount value={BigInt(movement.creditMinor)} currency={schedule.currency} />
                    </span>
                  )}
                  {movement.service && (
                    <span className="text-xs text-muted-foreground">
                      <ValueName value={movement.service} />
                    </span>
                  )}
                </span>
              </TableCell>
              <TableCell>
                {movement.entry ? (
                  entries ? (
                    <Link
                      to="/entries/$id"
                      params={{ id: movement.entry.id }}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      <EntryNumberText number={movement.entry} startMonth={startMonth} />
                    </Link>
                  ) : (
                    <EntryNumberText number={movement.entry} startMonth={startMonth} />
                  )
                ) : (
                  <span className="text-muted-foreground">{t.noEntry}</span>
                )}
              </TableCell>
              <TableCell className="max-sm:hidden whitespace-nowrap">
                {movement.entry ? formatDay(movement.entry.date) : t.noEntry}
              </TableCell>
              <TableCell numeric>
                <Amount
                  value={BigInt(movement.amounts.transactionMinor)}
                  currency={schedule.currency}
                />
              </TableCell>
              <TableCell numeric className="max-md:hidden">
                <LedgerAmount amounts={movement.amounts} ledger="book" currencies={currencies} />
              </TableCell>
              {currencies.parallel && (
                <TableCell numeric className="max-md:hidden">
                  <LedgerAmount
                    amounts={movement.amounts}
                    ledger="parallel"
                    currencies={currencies}
                  />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}
