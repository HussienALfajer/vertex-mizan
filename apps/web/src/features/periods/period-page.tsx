import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import {
  CHECKLIST_ITEMS,
  type PeriodDetail,
  periodDetailSchema,
  periodReasonSchema,
  periodReopenResultSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Button,
  Callout,
  Card,
  Checklist,
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
import {
  CircleCheckIcon,
  ClockIcon,
  FileQuestionIcon,
  LockIcon,
  LockOpenIcon,
  RotateCwIcon,
  ScaleIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { FormError } from '../../components/form-error';
import { ReasonDialog } from '../../components/reason-dialog';
import { ApiError, api, hasCode } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { Fact } from '../entries/entry-parts';
import {
  checklistItemLabel,
  checklistItems,
  PeriodName,
  PeriodStateBadge,
  PeriodsBackLink,
} from './period-parts';
import { periodQuery, periodsQuery } from './periods-queries';

const t = ar.periods;
const route = getRouteApi('/_app/_company/periods/$period');

/**
 * `/periods/:period` (S07 "Screens"): the month's state, its pre-close checklist with each item's
 * status in words, its count and the link to what fixes it, and the history of closes and
 * reopens. "إقفال الشهر" is enabled once the month has ended and every item passes; "إعادة فتح
 * الشهر" is offered on the latest closed month. Both ask for a reason (`periods.close`).
 */
export function PeriodPage() {
  const { period } = route.useParams();
  const { companyId } = useCompany();
  const detail = useQuery(periodQuery(companyId, period));
  if (hasCode(detail.error, 'VALIDATION_FAILED') || hasCode(detail.error, 'NOT_FOUND')) {
    return (
      <>
        <PeriodsBackLink />
        <EmptyState icon={<FileQuestionIcon />} title={t.detail.notFound} />
      </>
    );
  }
  if (detail.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-control w-64" />
        <Skeleton className="h-row" />
        <Skeleton className="h-row" />
      </div>
    );
  }
  if (detail.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <PeriodsBackLink />
        <FormError error={detail.error} />
        <Button variant="outline" onClick={() => void detail.refetch()}>
          <RotateCwIcon aria-hidden="true" />
          {ar.common.retry}
        </Button>
      </div>
    );
  }
  return <PeriodView data={detail.data} />;
}

function PeriodView({ data }: { data: PeriodDetail }) {
  const { companyId, me } = useCompany();
  const queryClient = useQueryClient();
  const list = useQuery(periodsQuery(companyId)).data;
  const [dialog, setDialog] = useState<'close' | 'reopen' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const latestClosed = list
    ?.filter((month) => month.state === 'closed')
    .map((month) => month.period)
    .sort()
    .at(-1);
  const passing = data.checklist.every((item) => item.result !== 'failed');
  // Rule 2's order: not before the first period, and every listed month before it closed.
  const inOrder =
    (data.firstPeriod === null || data.period >= data.firstPeriod) &&
    (list ?? []).every((month) => month.period >= data.period || month.state === 'closed');
  const closable = data.state !== 'closed' && data.ended && passing && inOrder;
  const reopenable =
    data.state === 'closed' && (latestClosed === undefined || latestClosed === data.period);
  const mayClose = can(me, 'periods.close');
  const passed = data.checklist.filter((item) => item.result !== 'failed').length;

  async function refresh(next?: PeriodDetail) {
    if (next) queryClient.setQueryData(periodQuery(companyId, data.period).queryKey, next);
    await queryClient.invalidateQueries({ queryKey: ['periods', companyId] });
    await queryClient.invalidateQueries({ queryKey: ['inbox', companyId] });
  }

  return (
    <>
      <PageHeader
        back={<PeriodsBackLink />}
        title={
          <span className="flex flex-wrap items-center gap-x-3">
            {t.detail.title}
            <PeriodName period={data.period} />
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PeriodStateBadge state={data.state} />
            <Button
              variant="outline"
              render={<Link to="/revaluation" search={{ period: data.period, ledger: 'book' }} />}
            >
              <ScaleIcon aria-hidden="true" />
              {t.detail.revaluation}
            </Button>
            {mayClose && data.state !== 'closed' && (
              <Button disabled={!closable} onClick={() => setDialog('close')}>
                <LockIcon aria-hidden="true" />
                {t.close.action}
              </Button>
            )}
            {mayClose && reopenable && (
              <Button variant="outline" onClick={() => setDialog('reopen')}>
                <LockOpenIcon aria-hidden="true" />
                {t.reopen.action}
              </Button>
            )}
          </div>
        }
      />
      {notice && <Callout role="status" tone="info" icon={<CircleCheckIcon />} title={notice} />}
      {!data.ended && <Callout tone="neutral" icon={<ClockIcon />} title={t.detail.notEnded} />}
      {mayClose && data.state !== 'closed' && data.ended && !passing && (
        <p className="text-muted-foreground text-sm">{t.close.blocked}</p>
      )}
      {mayClose && data.state !== 'closed' && data.ended && passing && !inOrder && (
        <p className="text-muted-foreground text-sm">{t.close.outOfOrder}</p>
      )}
      <Card className="p-6">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Fact label={t.table.state}>{t.states[data.state]}</Fact>
          <Fact label={t.table.ended}>{data.ended ? t.table.endedYes : t.table.endedNo}</Fact>
          <Fact label={t.detail.firstPeriod}>
            {data.firstPeriod ? (
              <bdi dir="ltr" className="tabular-nums">
                {data.firstPeriod}
              </bdi>
            ) : (
              t.table.none
            )}
          </Fact>
        </dl>
      </Card>
      <Section id="checklist" title={t.detail.checklist}>
        <Checklist
          aria-labelledby="checklist"
          items={checklistItems(data.checklist, data.period, me)}
          summary={
            <>
              {`${t.detail.summary}: `}
              <bdi dir="ltr" className="tabular-nums">
                {`${passed}/${data.checklist.length}`}
              </bdi>
            </>
          }
        />
      </Section>
      <Section id="history" title={t.detail.history}>
        <History data={data} />
      </Section>
      <ReasonDialog
        open={dialog === 'close'}
        onOpenChange={(open) => setDialog(open ? 'close' : null)}
        title={`${t.close.title} ${data.period}`}
        description={t.close.description}
        reasonLabel={t.close.reason}
        submitLabel={t.close.confirm}
        schema={periodReasonSchema}
        maxLength={500}
        lengthError={t.reasonLength}
        errorDetail={refusalDetail}
        onConfirm={async (reason) => {
          const next = await api('POST', `/periods/${data.period}/close`, {
            company: companyId,
            body: { reason },
            schema: periodDetailSchema,
          });
          setNotice(t.close.done);
          await refresh(next);
        }}
      />
      <ReasonDialog
        open={dialog === 'reopen'}
        onOpenChange={(open) => setDialog(open ? 'reopen' : null)}
        title={`${t.reopen.title} ${data.period}`}
        description={t.reopen.description}
        reasonLabel={t.reopen.reason}
        submitLabel={t.reopen.confirm}
        schema={periodReasonSchema}
        maxLength={500}
        lengthError={t.reasonLength}
        errorDetail={refusalDetail}
        onConfirm={async (reason) => {
          const result = await api('POST', `/periods/${data.period}/reopen`, {
            company: companyId,
            body: { reason },
            schema: periodReopenResultSchema,
          });
          setNotice(
            result.queuedEvents > 0
              ? `${t.reopen.done} ${t.reopen.queued}: ${result.queuedEvents}`
              : t.reopen.done,
          );
          await refresh(result.period);
        }}
      />
    </>
  );
}

/** What a refused close or reopen names: the failing items, or the month to deal with first. */
function refusalDetail(error: unknown): ReactNode {
  if (!(error instanceof ApiError)) return null;
  const details = error.details as Record<string, unknown> | undefined;
  if (error.code === 'CHECKLIST_FAILED' && typeof details?.items === 'string') {
    const items = details.items.split(',').filter(Boolean);
    return (
      <div className="flex flex-col gap-1 text-sm">
        <p className="font-medium">{t.close.failing}</p>
        <ul className="list-inside list-disc">
          {[...items]
            .sort(
              (a, b) =>
                CHECKLIST_ITEMS.indexOf(a as (typeof CHECKLIST_ITEMS)[number]) -
                CHECKLIST_ITEMS.indexOf(b as (typeof CHECKLIST_ITEMS)[number]),
            )
            .map((item) => (
              <li key={item}>{checklistItemLabel(item)}</li>
            ))}
        </ul>
      </div>
    );
  }
  if (error.code === 'PERIOD_ORDER' && typeof details?.period === 'string') {
    return (
      <p className="text-sm">
        {`${t.close.order}: `}
        <bdi dir="ltr" className="tabular-nums">
          {details.period}
        </bdi>
      </p>
    );
  }
  return null;
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

/** The month's closes and reopens, the latest first. */
function History({ data }: { data: PeriodDetail }) {
  if (data.history.length === 0) {
    return <p className="text-muted-foreground">{t.detail.noHistory}</p>;
  }
  return (
    <Card className="min-w-0 overflow-x-auto">
      <Table aria-label={t.detail.history}>
        <TableHeader>
          <TableRow>
            <TableHead>{t.detail.kind}</TableHead>
            <TableHead>{t.detail.reason}</TableHead>
            <TableHead>{t.detail.user}</TableHead>
            <TableHead>{t.detail.at}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...data.history].reverse().map((event) => (
            <TableRow key={event.id}>
              <TableCell>{t.events[event.kind]}</TableCell>
              <TableCell className="whitespace-normal">
                <bdi>{event.reason}</bdi>
              </TableCell>
              <TableCell>
                <bdi>{event.user.name}</bdi>
              </TableCell>
              <TableCell className="whitespace-nowrap">{formatDateTime(event.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
