import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type {
  CurrencyCode,
  Ledger,
  RecognitionAmounts,
  RecognitionState,
  RevenueMovement,
  RevenueSchedule,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { Amount, Badge, Button } from '@vertex-mizan/ui';
import { ArrowRightIcon } from 'lucide-react';
import { damascusToday, formatDay, formatMonthName } from '../../lib/format';
import { companyQuery } from '../company/company-queries';

const t = ar.revenue;

/** A dimension value as the revenue screens name it: its code first when it has one. */
export function ValueName({
  value,
}: {
  value: { code: string | null; name: string } | null | undefined;
}) {
  if (!value) return <span className="text-muted-foreground">{t.table.none}</span>;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      {value.code && (
        <bdi dir="ltr" className="font-medium tabular-nums">
          {value.code}
        </bdi>
      )}
      <bdi>{value.name}</bdi>
    </span>
  );
}

const stateTones = {
  active: 'info',
  completed: 'success',
  voided: 'neutral',
} as const satisfies Record<RecognitionState, string>;

/** A schedule's state, in words and tone. */
export function ScheduleStateBadge({ state }: { state: RecognitionState }) {
  return (
    <Badge tone={stateTones[state]} className="w-fit">
      {t.states[state]}
    </Badge>
  );
}

/** A movement's kind in Arabic, with a neutral word for one this build does not know. */
export function movementLabel(kind: RevenueMovement['kind'] | string): string {
  return kind in t.movements ? t.movements[kind as RevenueMovement['kind']] : t.unknownMovement;
}

/** `YYYY-MM` as people in Syria read it: the month's name and its year. */
export function formatMonth(month: string) {
  return (
    <span className="whitespace-nowrap">
      {`${formatMonthName(Number(month.slice(5, 7)))} `}
      <bdi dir="ltr">{month.slice(0, 4)}</bdi>
    </span>
  );
}

/** The current month in Damascus, `YYYY-MM`. */
export function currentMonth(): string {
  return damascusToday().slice(0, 7);
}

/** The `count` months ending with `last`, oldest first (`YYYY-MM`). */
export function monthsEnding(last: string, count: number): { from: string; to: string } {
  const index = Number(last.slice(0, 4)) * 12 + Number(last.slice(5, 7)) - 1 - (count - 1);
  const from = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  return { from, to: last };
}

/** A schedule's service period, or its milestone. */
export function PeriodText({ schedule }: { schedule: RevenueSchedule }) {
  if (schedule.serviceFrom && schedule.serviceTo) {
    return (
      <span className="whitespace-nowrap">
        {formatDay(schedule.serviceFrom)}
        {' – '}
        {formatDay(schedule.serviceTo)}
      </span>
    );
  }
  if (schedule.milestoneId) return <span>{t.lineSources[schedule.lineSource]}</span>;
  return <span className="text-muted-foreground">{t.table.none}</span>;
}

/** The book and parallel ledgers' currencies of the active company. */
export function useLedgerCurrencies(companyId: string): {
  book: CurrencyCode | null;
  parallel: CurrencyCode | null;
} {
  const company = useQuery(companyQuery(companyId)).data;
  return {
    book: company?.ledgers.book.currency ?? null,
    parallel: company?.ledgers.parallel?.currency ?? null,
  };
}

/** One ledger's amount of a schedule's amounts, with that ledger's currency; a dash without it. */
export function LedgerAmount({
  amounts,
  ledger,
  currencies,
  strong = false,
}: {
  amounts: RecognitionAmounts;
  ledger: Ledger;
  currencies: { book: CurrencyCode | null; parallel: CurrencyCode | null };
  strong?: boolean;
}) {
  const minor = ledger === 'book' ? amounts.bookMinor : amounts.parallelMinor;
  const currency = ledger === 'book' ? currencies.book : currencies.parallel;
  if (minor === null || currency === null) {
    return <span className="text-muted-foreground">{t.table.none}</span>;
  }
  return <Amount value={BigInt(minor)} currency={currency} strong={strong} />;
}

/** A schedule's invoice number, linked to its page. */
export function ScheduleLink({ id, invoiceNumber }: { id: string; invoiceNumber: string }) {
  return (
    <Link
      to="/revenue/$id"
      params={{ id }}
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      <bdi dir="ltr">{invoiceNumber}</bdi>
    </Link>
  );
}

/** The way back to `/revenue`, above a schedule's title. */
export function RevenueBackLink() {
  return (
    <Button variant="ghost" size="sm" className="w-fit" render={<Link to="/revenue" />}>
      <ArrowRightIcon aria-hidden="true" />
      {t.schedule.back}
    </Button>
  );
}
