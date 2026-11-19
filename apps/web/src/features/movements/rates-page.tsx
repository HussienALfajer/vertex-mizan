import { useQuery } from '@tanstack/react-query';
import type { CurrencyCode, Me, RateRow } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Badge,
  Button,
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
import { CalendarIcon } from 'lucide-react';
import { useState } from 'react';
import { addDays, damascusToday, formatDay } from '../../lib/format';
import { dayRatesQuery, rateHistoryQuery } from '../../lib/movements';
import { can } from '../../lib/session';
import { DayRatesSummary } from './dashboard-page';
import { DayRatesDialog } from './day-rates-dialog';

const t = ar.movements.ratesPage;

/** A recorded day: each quote's rate in force that day, and whether a rate of it was corrected. */
interface RateDay {
  day: string;
  rates: Partial<Record<CurrencyCode, string>>;
  corrected: boolean;
}

/** A rate as typed, without the zeros the table's `numeric` adds (`13000.0000000000` → `13000`). */
const plainRate = (rate: string) =>
  rate.includes('.') ? rate.replace(/0+$/, '').replace(/\.$/, '') : rate;

/**
 * The rows of the range by day, newest first: the standing row of each pair (a correction stands
 * in place of the row it supersedes), and the day marked when one was corrected.
 */
export function rateDays(rows: readonly RateRow[], base: CurrencyCode): RateDay[] {
  const days = new Map<string, RateDay>();
  for (const row of rows) {
    if (row.base !== base) continue;
    const day = days.get(row.effectiveOn) ?? { day: row.effectiveOn, rates: {}, corrected: false };
    if (row.superseded) day.corrected = true;
    else day.rates[row.quote] = plainRate(row.rate);
    days.set(row.effectiveOn, day);
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

/**
 * `/rates` (S13 screen 8): today's rates (1 USD in SYP and in TRY) with the dialog to record or
 * correct them, and the rates recorded over the last 30 days.
 */
export function RatesPage({ me, companyId }: { me: Me; companyId: string }) {
  const [recording, setRecording] = useState(false);
  const today = useQuery(dayRatesQuery(companyId));
  // The 30 days end on the server's today (Damascus), once it answers.
  const to = today.data?.date ?? damascusToday();
  const history = useQuery({
    ...rateHistoryQuery(companyId, addDays(to, -29), to),
    enabled: today.data !== undefined,
  });
  const canRecord = can(me, 'rates.manage');
  const base = today.data?.rates[0]?.base ?? 'USD';
  const quotes = today.data?.rates.map((rate) => rate.quote) ?? [];

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          canRecord && (
            <Button onClick={() => setRecording(true)}>{ar.movements.rates.record}</Button>
          )
        }
      />
      <div className="flex flex-col gap-6">
        {today.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : today.isError ? (
          <EmptyState
            title={ar.common.errorTitle}
            description={ar.common.errorDescription}
            action={
              <Button variant="outline" onClick={() => void today.refetch()}>
                {ar.common.retry}
              </Button>
            }
          />
        ) : (
          <DayRatesSummary
            rates={today.data}
            canRates={canRecord}
            onRates={() => setRecording(true)}
          />
        )}

        {!today.isError && (
          <section className="flex flex-col gap-3" aria-labelledby="rate-history">
            <h2 id="rate-history" className="font-bold text-lg">
              {t.history}
            </h2>
            {history.isPending || today.isPending ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-row w-full" />
                <Skeleton className="h-row w-full" />
              </div>
            ) : history.isError ? (
              <EmptyState
                title={ar.common.errorTitle}
                description={ar.common.errorDescription}
                action={
                  <Button variant="outline" onClick={() => void history.refetch()}>
                    {ar.common.retry}
                  </Button>
                }
              />
            ) : (
              <History days={rateDays(history.data, base)} quotes={quotes} />
            )}
          </section>
        )}
      </div>
      <DayRatesDialog companyId={companyId} open={recording} onOpenChange={setRecording} />
    </>
  );
}

function History({ days, quotes }: { days: RateDay[]; quotes: readonly CurrencyCode[] }) {
  if (days.length === 0) return <EmptyState icon={<CalendarIcon />} title={t.historyEmpty} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.columns.day}</TableHead>
          {quotes.map((quote) => (
            <TableHead key={quote} numeric>
              {ar.accounting.currencies[quote]}
            </TableHead>
          ))}
          <TableHead>
            <span className="sr-only">{t.columns.note}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {days.map((day) => (
          <TableRow key={day.day}>
            <TableCell>{formatDay(day.day)}</TableCell>
            {quotes.map((quote) => (
              <TableCell key={quote} numeric>
                <bdi dir="ltr" className="tabular-nums">
                  {day.rates[quote] ?? '—'}
                </bdi>
              </TableCell>
            ))}
            <TableCell>
              {day.corrected && (
                <Badge tone="info" title={t.correctedHint}>
                  {t.corrected}
                </Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
