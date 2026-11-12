import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import type {
  ReconciliationAnnotation,
  ReconciliationClientDayDetail,
  ReconciliationDayDifference,
  ReconciliationDayTotal,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  Badge,
  Button,
  Callout,
  Card,
  Digest,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import {
  CircleCheckIcon,
  ClockIcon,
  FileWarningIcon,
  LockIcon,
  MinusCircleIcon,
  RotateCwIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { FormError } from '../../components/form-error';
import { hasCode } from '../../lib/api';
import { formatDateTime, formatDay } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { EntryNumberText, useFiscalYearStartMonth } from '../entries/entry-parts';
import { EventStateText, reasonLabel, typeLabel } from '../inbox/inbox-parts';
import {
  annotationLabel,
  DayState,
  deliveryLabel,
  kindLabel,
  MoneyText,
  MonthBackLink,
} from './reconciliation-parts';
import { reconciliationDayQuery } from './reconciliation-queries';

const t = ar.reconciliation;
const d = t.day;
const route = getRouteApi('/_app/_company/reconciliation/$date');

/**
 * `/reconciliation/:date?client=` (S08 "Screens", rules 8–11): the day for each client: its state;
 * the totals per type and currency, Hub beside Mizan; the differences, each with its kind, Hub's
 * event id (copyable), both sides' type, date, amount, Hub's delivery and Mizan's state linked to
 * the inbox; the annotations with their entries and items; the date's reports, the latest marked.
 */
export function ReconciliationDayPage() {
  const { date } = route.useParams();
  const { client } = route.useSearch();
  const { companyId } = useCompany();
  const day = useQuery(reconciliationDayQuery(companyId, date, client));
  const month = date.slice(0, 7);
  const header = (
    <>
      <MonthBackLink month={month} client={client} />
      <PageHeader title={`${d.title} ${formatDay(date)}`} />
    </>
  );
  if (day.isPending) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
        </div>
      </>
    );
  }
  if (day.isError) {
    return (
      <>
        {header}
        <div className="flex flex-col items-start gap-3">
          <FormError error={day.error} />
          {!hasCode(day.error, 'NOT_FOUND') && !hasCode(day.error, 'VALIDATION_FAILED') && (
            <Button variant="outline" onClick={() => void day.refetch()}>
              <RotateCwIcon aria-hidden="true" />
              {ar.common.retry}
            </Button>
          )}
        </div>
      </>
    );
  }
  const data = day.data;
  return (
    <>
      {header}
      {data.clients.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <DayState state={data.state} closed={data.closed} />
        </div>
      )}
      {data.closed && (
        <Callout
          tone="neutral"
          icon={<LockIcon />}
          title={t.afterClose}
          description={t.afterCloseDescription}
        />
      )}
      {data.clients.length === 0 && (
        <Callout tone="neutral" icon={<MinusCircleIcon />} title={t.month.empty.title} />
      )}
      {data.clients.map((detail) => (
        <ClientDay key={detail.client.id} detail={detail} closed={data.closed} />
      ))}
    </>
  );
}

function ClientDay({ detail, closed }: { detail: ReconciliationClientDayDetail; closed: boolean }) {
  const id = `client-${detail.client.id}`;
  const gaps = detail.differences.length;
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={id} className="text-lg font-bold">
          <bdi>{detail.client.name}</bdi>
        </h2>
        <DayState state={detail.state} gaps={gaps} closed={closed} />
        <span className="text-muted-foreground text-sm">
          {`${d.from}: `}
          {formatDay(detail.client.reconcileFrom)}
        </span>
      </div>
      <StateCallout detail={detail} />
      <Section id={`${id}-totals`} title={d.totals.title}>
        <Totals totals={detail.totals} />
      </Section>
      <Section id={`${id}-differences`} title={d.differences.title}>
        <Differences differences={detail.differences} />
      </Section>
      <Section id={`${id}-annotations`} title={d.annotations.title}>
        <p className="text-muted-foreground text-sm">{d.annotations.description}</p>
        <Annotations annotations={detail.annotations} />
      </Section>
      <Section id={`${id}-reports`} title={d.reports.title}>
        <Reports detail={detail} />
      </Section>
    </section>
  );
}

function StateCallout({ detail }: { detail: ReconciliationClientDayDetail }) {
  switch (detail.state) {
    case 'pending':
      return (
        <Callout
          tone="info"
          icon={<ClockIcon />}
          title={d.noReport}
          description={d.noReportPending}
        />
      );
    case 'missing':
      return (
        <Callout
          tone="warning"
          icon={<FileWarningIcon />}
          title={d.noReport}
          description={d.noReportMissing}
        />
      );
    case 'matched':
      return detail.differences.length === 0 && detail.annotations.length === 0 ? (
        <Callout
          tone="info"
          icon={<CircleCheckIcon />}
          title={d.matched}
          description={d.matchedDescription}
        />
      ) : null;
    case 'not_required':
      return <Callout tone="neutral" icon={<MinusCircleIcon />} title={d.notRequired} />;
    default:
      return null;
  }
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <h3 id={id} className="text-base font-bold">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Count({ value }: { value: number }) {
  return (
    <bdi dir="ltr" className="tabular-nums">
      {value}
    </bdi>
  );
}

/** A total's amount, or a dash for a type counted only. */
function TotalAmount({ total, minor }: { total: ReconciliationDayTotal; minor: string | null }) {
  if (total.currency === null || minor === null) {
    return <span className="text-muted-foreground">{d.totals.noAmount}</span>;
  }
  return <Amount value={BigInt(minor)} currency={total.currency} />;
}

/** Mizan's states of a total's events in words, the counts above zero only. */
function statesText(total: ReconciliationDayTotal): string {
  const parts = (['posted', 'recorded', 'held', 'resolved', 'dismissed'] as const)
    .filter((state) => total[state] > 0)
    .map((state) => `${d.totals[state]} ${total[state]}`);
  return parts.length === 0 ? d.totals.noAmount : parts.join(ar.common.listSeparator);
}

function Totals({ totals }: { totals: readonly ReconciliationDayTotal[] }) {
  if (totals.length === 0) return <p className="text-muted-foreground">{d.totals.none}</p>;
  return (
    <Card className="min-w-0 overflow-x-auto">
      <Table aria-label={d.totals.label}>
        <TableHeader>
          <TableRow>
            <TableHead>{d.totals.type}</TableHead>
            <TableHead>{d.totals.currency}</TableHead>
            <TableHead numeric>{d.totals.hubCount}</TableHead>
            <TableHead numeric>{d.totals.hubAmount}</TableHead>
            <TableHead numeric>{d.totals.receivedCount}</TableHead>
            <TableHead numeric>{d.totals.receivedAmount}</TableHead>
            <TableHead>{d.totals.states}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {totals.map((total) => (
            <TableRow key={`${total.type}:${total.currency ?? ''}`}>
              <TableCell>{typeLabel(total.type)}</TableCell>
              <TableCell>
                {total.currency === null ? (
                  <span className="text-muted-foreground">{d.totals.noCurrency}</span>
                ) : (
                  <bdi dir="ltr">{total.currency}</bdi>
                )}
              </TableCell>
              <TableCell numeric>
                <Count value={total.hubCount} />
              </TableCell>
              <TableCell numeric>
                <TotalAmount total={total} minor={total.hubAmountMinor} />
              </TableCell>
              <TableCell numeric>
                <Count value={total.receivedCount} />
              </TableCell>
              <TableCell numeric>
                <TotalAmount total={total} minor={total.receivedAmountMinor} />
              </TableCell>
              <TableCell className="text-sm">{statesText(total)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Hub's side of a difference: type, date, amount and delivery with its refusal code. */
function HubSide({ side }: { side: ReconciliationDayDifference['hub'] }) {
  if (side === null) return <span className="text-muted-foreground">{d.differences.absent}</span>;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span>{typeLabel(side.type)}</span>
      <span className="text-muted-foreground text-xs">
        {`${d.differences.date}: `}
        {formatDay(side.accountingDate)}
      </span>
      <MoneyText money={side.amount} />
      <span className="text-sm">
        {deliveryLabel(side.delivery)}
        {side.refusalCode && (
          <>
            {`${ar.common.listSeparator}${d.differences.refusal}: `}
            <bdi dir="ltr">{side.refusalCode}</bdi>
          </>
        )}
      </span>
    </span>
  );
}

/** Mizan's side of a difference: type, date, amount and state, linked to the inbox. */
function MizanSide({ side }: { side: ReconciliationDayDifference['mizan'] }) {
  const { me } = useCompany();
  if (side === null) return <span className="text-muted-foreground">{d.differences.absent}</span>;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span>{typeLabel(side.type)}</span>
      <span className="text-muted-foreground text-xs">
        {`${d.differences.date}: `}
        {formatDay(side.accountingDate)}
      </span>
      <MoneyText money={side.amount} />
      <EventStateText state={side.state} reason={side.holdReason} />
      {can(me, 'events.read') && (
        <Link
          to="/inbox/$id"
          params={{ id: side.inboxId }}
          className="text-primary text-sm underline-offset-4 hover:underline"
        >
          {d.differences.openEvent}
        </Link>
      )}
    </span>
  );
}

function Differences({ differences }: { differences: readonly ReconciliationDayDifference[] }) {
  if (differences.length === 0) {
    return <p className="text-muted-foreground">{d.differences.none}</p>;
  }
  return (
    <Card className="min-w-0 overflow-x-auto">
      <Table aria-label={d.differences.label}>
        <TableHeader>
          <TableRow>
            <TableHead>{d.differences.kind}</TableHead>
            <TableHead>{d.differences.event}</TableHead>
            <TableHead>{d.differences.hub}</TableHead>
            <TableHead>{d.differences.mizan}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {differences.map((difference) => (
            <TableRow key={`${difference.kind}:${difference.eventId}`} data-kind={difference.kind}>
              <TableCell>
                <Badge tone="danger">{kindLabel(difference.kind)}</Badge>
              </TableCell>
              <TableCell>
                <Digest
                  value={difference.eventId}
                  copyLabel={d.differences.copy}
                  copiedLabel={d.differences.copied}
                />
              </TableCell>
              <TableCell className="align-top">
                <HubSide side={difference.hub} />
              </TableCell>
              <TableCell className="align-top">
                <MizanSide side={difference.mizan} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function AnnotationRow({ annotation }: { annotation: ReconciliationAnnotation }) {
  const { companyId, me } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const link = 'text-primary underline-offset-4 hover:underline';
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-annotation={annotation.kind}>
      <Badge tone={annotation.kind === 'held' ? 'warning' : 'neutral'}>
        {annotationLabel(annotation.kind)}
      </Badge>
      {annotation.type !== null &&
        (annotation.inboxId !== null && can(me, 'events.read') ? (
          <Link to="/inbox/$id" params={{ id: annotation.inboxId }} className={link}>
            {typeLabel(annotation.type)}
          </Link>
        ) : (
          <span>{typeLabel(annotation.type)}</span>
        ))}
      {annotation.holdReason !== null && (
        <span className="text-muted-foreground text-sm">{reasonLabel(annotation.holdReason)}</span>
      )}
      {annotation.reason !== null && (
        <span className="text-sm">
          {`${d.annotations.reason}: `}
          <bdi>{annotation.reason}</bdi>
        </span>
      )}
      {annotation.entry !== null && (
        <span className="text-sm">
          {`${d.annotations.entry}: `}
          {can(me, 'entries.read') ? (
            <Link to="/entries/$id" params={{ id: annotation.entry.id }} className={link}>
              <EntryNumberText number={annotation.entry.number} startMonth={startMonth} />
            </Link>
          ) : (
            <EntryNumberText number={annotation.entry.number} startMonth={startMonth} />
          )}
        </span>
      )}
      {annotation.openItemId !== null && can(me, 'open_items.read') && (
        <Link
          to="/open-items/$id"
          params={{ id: annotation.openItemId }}
          className={`${link} text-sm`}
        >
          {d.annotations.openItem}
        </Link>
      )}
    </li>
  );
}

function Annotations({ annotations }: { annotations: readonly ReconciliationAnnotation[] }) {
  if (annotations.length === 0) {
    return <p className="text-muted-foreground">{d.annotations.none}</p>;
  }
  return (
    <Card className="min-w-0 p-4">
      <ul className="flex flex-col gap-3" aria-label={d.annotations.title}>
        {annotations.map((annotation, index) => (
          <AnnotationRow
            // An annotation has no id of its own: its event, or its entry and item.
            key={`${annotation.kind}:${annotation.eventId ?? annotation.entry?.id ?? index}:${annotation.openItemId ?? ''}`}
            annotation={annotation}
          />
        ))}
      </ul>
    </Card>
  );
}

function Reports({ detail }: { detail: ReconciliationClientDayDetail }) {
  if (detail.reports.length === 0) {
    return <p className="text-muted-foreground">{d.reports.none}</p>;
  }
  return (
    <Card className="min-w-0 overflow-x-auto">
      <Table aria-label={d.reports.label}>
        <TableHeader>
          <TableRow>
            <TableHead>{d.reports.report}</TableHead>
            <TableHead>{d.reports.generatedAt}</TableHead>
            <TableHead>{d.reports.receivedAt}</TableHead>
            <TableHead numeric>{d.reports.events}</TableHead>
            <TableHead>{d.reports.status}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {detail.reports.map((report) => (
            <TableRow key={report.reportId} data-latest={report.latest}>
              <TableCell>
                <Digest
                  value={report.reportId}
                  copyLabel={d.reports.copy}
                  copiedLabel={d.reports.copied}
                />
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {formatDateTime(report.generatedAt)}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {formatDateTime(report.receivedAt)}
              </TableCell>
              <TableCell numeric>
                <Count value={report.eventCount} />
              </TableCell>
              <TableCell>
                {report.latest ? (
                  <Badge tone="success">{d.reports.latest}</Badge>
                ) : (
                  <span className="text-muted-foreground text-sm">{d.reports.superseded}</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
