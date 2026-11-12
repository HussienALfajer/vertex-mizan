import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import type { ReconciliationMonth, ReconciliationMonthDay } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Button,
  Callout,
  Card,
  Field,
  FieldLabel,
  Input,
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
import {
  CalendarOffIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LockIcon,
  PlugIcon,
  RotateCwIcon,
} from 'lucide-react';
import { FormError } from '../../components/form-error';
import { damascusToday, formatDay } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { monthDays, PeriodName, previousMonth } from '../periods/period-parts';
import { DayState, monthSearch } from './reconciliation-parts';
import { reconciliationMonthQuery } from './reconciliation-queries';

const t = ar.reconciliation;
const route = getRouteApi('/_app/_company/reconciliation/');

const ALL = 'all';

/** The month after a month, `YYYY-MM`. */
function nextMonth(month: string): string {
  const { last } = monthDays(month);
  const [year, day] = [Number(last.slice(0, 4)), Number(last.slice(5, 7))];
  return day === 12 ? `${year + 1}-01` : `${year}-${String(day + 1).padStart(2, '0')}`;
}

/**
 * `/reconciliation?month=&client=` (S08 "Screens", rules 10, 15): the month's days, each with its
 * state in words and icon, Hub's count, Mizan's received and posted counts, the gaps and the
 * annotations; "بعد الإقفال" on a closed month's days that are not clean; the matched days in a row
 * up to yesterday; the client filter when several clients report; month navigation.
 */
export function ReconciliationPage() {
  const search = route.useSearch();
  const navigate = useNavigate();
  const month = search.month ?? damascusToday().slice(0, 7);
  const go = (next: { month?: string; client?: string | undefined }) =>
    void navigate({
      to: '/reconciliation',
      search: monthSearch(next.month ?? month, 'client' in next ? next.client : search.client),
    });
  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      <search className="flex flex-wrap items-end gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={t.month.previous}
          onClick={() => go({ month: previousMonth(month) })}
        >
          {/* In RTL the previous month is to the right. */}
          <ChevronRightIcon aria-hidden="true" />
        </Button>
        <Field className="w-48">
          <FieldLabel>{t.month.label}</FieldLabel>
          <Input
            type="month"
            dir="ltr"
            value={month}
            onChange={(event) => {
              if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) {
                go({ month: event.target.value });
              }
            }}
          />
        </Field>
        <Button
          variant="outline"
          size="icon"
          aria-label={t.month.next}
          onClick={() => go({ month: nextMonth(month) })}
        >
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
      </search>
      <Month month={month} client={search.client} onClient={(client) => go({ client })} />
    </>
  );
}

function Month({
  month,
  client,
  onClient,
}: {
  month: string;
  client: string | undefined;
  onClient: (client: string | undefined) => void;
}) {
  const { companyId, me } = useCompany();
  const days = useQuery(reconciliationMonthQuery(companyId, month, client));
  if (days.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-row" />
        <Skeleton className="h-row" />
        <Skeleton className="h-row" />
      </div>
    );
  }
  if (days.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <FormError error={days.error} />
        <Button variant="outline" onClick={() => void days.refetch()}>
          <RotateCwIcon aria-hidden="true" />
          {ar.common.retry}
        </Button>
      </div>
    );
  }
  const data = days.data;
  if (data.clients.length === 0 && client === undefined) {
    return (
      <Callout
        tone="neutral"
        icon={<PlugIcon />}
        title={t.month.empty.title}
        description={t.month.empty.description}
        action={
          can(me, 'api_clients.read') ? (
            <Button variant="outline" render={<Link to="/settings/api-clients" />}>
              {t.month.empty.action}
            </Button>
          ) : null
        }
      />
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-lg font-bold">
            <PeriodName period={data.month} />
          </h2>
          <p className="text-muted-foreground text-sm" data-slot="matched-streak">
            {`${t.month.streak}: `}
            <bdi dir="ltr" className="tabular-nums">
              {data.matchedStreak}
            </bdi>
          </p>
        </div>
        {data.clients.length > 1 && (
          <div className="w-64">
            <SelectField
              label={t.month.client}
              value={client ?? ALL}
              options={[
                { value: ALL, label: t.month.allClients },
                ...data.clients.map((option) => ({ value: option.id, label: option.name })),
              ]}
              onValueChange={(next) => onClient(next === ALL ? undefined : next)}
            />
          </div>
        )}
      </div>
      {data.closed && (
        <Callout
          tone="neutral"
          icon={<LockIcon />}
          title={t.afterClose}
          description={t.afterCloseDescription}
        />
      )}
      {data.days.every((day) => day.state === 'not_required') ? (
        <Callout
          tone="neutral"
          icon={<CalendarOffIcon />}
          title={t.month.notRequired.title}
          description={t.month.notRequired.description}
        />
      ) : (
        <Days data={data} client={client} />
      )}
    </>
  );
}

/** A day's counts over the clients shown: Hub's count is unknown while no client reported. */
function countsOf(day: ReconciliationMonthDay) {
  const reported = day.clients.filter((client) => client.hubCount !== null);
  const sum = (pick: (client: ReconciliationMonthDay['clients'][number]) => number) =>
    day.clients.reduce((total, client) => total + pick(client), 0);
  return {
    hubCount:
      reported.length === 0 ? null : reported.reduce((total, c) => total + (c.hubCount ?? 0), 0),
    received: sum((client) => client.receivedCount),
    posted: sum((client) => client.postedCount),
    gaps: sum((client) => client.gaps),
    annotations: sum((client) => client.annotations),
  };
}

function Count({ value }: { value: number | null }) {
  if (value === null)
    return <span className="text-muted-foreground">{t.month.table.noReport}</span>;
  return (
    <bdi dir="ltr" className="tabular-nums">
      {value}
    </bdi>
  );
}

function Days({ data, client }: { data: ReconciliationMonth; client: string | undefined }) {
  return (
    <Card className="min-w-0 overflow-x-auto">
      <Table aria-label={t.month.table.label}>
        <TableHeader>
          <TableRow>
            <TableHead>{t.month.table.day}</TableHead>
            <TableHead>{t.month.table.state}</TableHead>
            <TableHead numeric>{t.month.table.hubCount}</TableHead>
            <TableHead numeric>{t.month.table.received}</TableHead>
            <TableHead numeric>{t.month.table.posted}</TableHead>
            <TableHead numeric>{t.month.table.gaps}</TableHead>
            <TableHead numeric>{t.month.table.annotations}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.days.map((day) => {
            const counts = countsOf(day);
            const required = day.state !== 'not_required';
            return (
              <TableRow
                key={day.date}
                data-state={day.state}
                className={required ? undefined : 'text-muted-foreground'}
              >
                <TableCell className="whitespace-nowrap">
                  <Link
                    to="/reconciliation/$date"
                    params={{ date: day.date }}
                    search={client ? { client } : {}}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {formatDay(day.date)}
                  </Link>
                </TableCell>
                <TableCell>
                  <DayState state={day.state} gaps={counts.gaps} closed={data.closed} />
                </TableCell>
                <TableCell numeric>
                  <Count value={counts.hubCount} />
                </TableCell>
                <TableCell numeric>
                  <Count value={counts.received} />
                </TableCell>
                <TableCell numeric>
                  <Count value={counts.posted} />
                </TableCell>
                <TableCell numeric>
                  <Count value={counts.gaps} />
                </TableCell>
                <TableCell numeric>
                  <Count value={counts.annotations} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
