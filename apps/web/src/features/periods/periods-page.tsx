import { useQuery } from '@tanstack/react-query';
import type { PeriodSummary } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Badge,
  Button,
  Card,
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
import { CalendarCheckIcon, CircleCheckIcon, CircleXIcon, RotateCwIcon } from 'lucide-react';
import { FormError } from '../../components/form-error';
import { formatDateTime } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { PeriodLink, PeriodStateBadge } from './period-parts';
import { periodsQuery } from './periods-queries';

const t = ar.periods;

/**
 * `/periods` (S07 "Screens"): the months from the first period to the current one, the latest
 * first, each with its state, whether it has ended, its checklist summary while it is ended and
 * not closed, and its last close or reopen with the reason and the person.
 */
export function PeriodsPage() {
  const { companyId } = useCompany();
  const list = useQuery(periodsQuery(companyId));
  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {list.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
        </div>
      ) : list.isError ? (
        <div className="flex flex-col items-start gap-3">
          <FormError error={list.error} />
          <Button variant="outline" onClick={() => void list.refetch()}>
            <RotateCwIcon aria-hidden="true" />
            {ar.common.retry}
          </Button>
        </div>
      ) : list.data.length === 0 ? (
        <EmptyState
          icon={<CalendarCheckIcon />}
          title={t.empty.title}
          description={t.empty.description}
        />
      ) : (
        <Card className="min-w-0 overflow-x-auto">
          <Table aria-label={t.table.label}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.table.period}</TableHead>
                <TableHead>{t.table.state}</TableHead>
                <TableHead className="max-sm:hidden">{t.table.ended}</TableHead>
                <TableHead>{t.table.checklist}</TableHead>
                <TableHead className="max-md:hidden">{t.table.lastEvent}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...list.data].reverse().map((period) => (
                <PeriodRow key={period.period} period={period} />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}

function PeriodRow({ period }: { period: PeriodSummary }) {
  return (
    <TableRow>
      <TableCell>
        <PeriodLink period={period.period} />
      </TableCell>
      <TableCell>
        <PeriodStateBadge state={period.state} />
      </TableCell>
      <TableCell className="max-sm:hidden">
        {period.ended ? t.table.endedYes : t.table.endedNo}
      </TableCell>
      <TableCell>
        <ChecklistSummary failing={period.failingItems} />
      </TableCell>
      <TableCell className="max-md:hidden">
        {period.lastEvent ? (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span>
              {`${t.events[period.lastEvent.kind]} · `}
              <bdi>{period.lastEvent.user.name}</bdi>
              {' · '}
              {formatDateTime(period.lastEvent.createdAt)}
            </span>
            <bdi className="text-muted-foreground text-xs">{period.lastEvent.reason}</bdi>
          </span>
        ) : (
          <span className="text-muted-foreground">{t.table.none}</span>
        )}
      </TableCell>
    </TableRow>
  );
}

/** The checklist of an ended month not closed: all passed, or how many items fail. */
function ChecklistSummary({ failing }: { failing: number | null }) {
  if (failing === null) return <span className="text-muted-foreground">{t.table.none}</span>;
  if (failing === 0) {
    return (
      <Badge tone="success" className="w-fit">
        <CircleCheckIcon aria-hidden="true" />
        {t.table.allPassed}
      </Badge>
    );
  }
  return (
    <Badge tone="danger" className="w-fit">
      <CircleXIcon aria-hidden="true" />
      {`${t.table.failing}: `}
      <bdi dir="ltr" className="tabular-nums">
        {failing}
      </bdi>
    </Badge>
  );
}
