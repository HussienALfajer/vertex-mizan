import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import {
  type Ledger,
  RECOGNITION_STATES,
  type RecognitionState,
  type RevenueMonth,
  type RevenueScheduleQuery,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  Button,
  Callout,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DimensionPicker,
  EmptyState,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@vertex-mizan/ui';
import { CalendarSearchIcon, CircleAlertIcon, ListIcon, RotateCwIcon, XIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { FormError } from '../../components/form-error';
import { formatDay } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { dimensionPickerLabels, pickerValues } from '../entries/entry-parts';
import { useDimensionCatalog } from '../entries/entry-queries';
import { slotLabel } from '../inbox/inbox-parts';
import { ReportLedgerSwitch } from '../receivables/receivables-parts';
import {
  currentMonth,
  formatMonth,
  LedgerAmount,
  monthsEnding,
  PeriodText,
  ScheduleLink,
  ScheduleStateBadge,
  useLedgerCurrencies,
  ValueName,
} from './revenue-parts';
import { revenueMonthsQuery, revenuePreviewQuery, revenueSchedulesQuery } from './revenue-queries';

const t = ar.revenue;
const route = getRouteApi('/_app/_company/revenue/');

export const REVENUE_VIEWS = ['schedules', 'months'] as const;
export type RevenueView = (typeof REVENUE_VIEWS)[number];

/** The months `/revenue` reads: the API's longest range, ending with the current month. */
const MONTHS = 24;
/** The months the months tab lists, latest first. */
const SHOWN_MONTHS = 12;

interface Filters {
  readonly state: RecognitionState | 'any';
  readonly client: string | null;
  readonly contract: string | null;
  readonly month: string;
}

const noFilters: Filters = { state: 'any', client: null, contract: null, month: '' };

const stateOptions = [
  { value: 'any' as const, label: t.filters.anyState },
  ...RECOGNITION_STATES.map((state) => ({ value: state, label: t.states[state] })),
];

function queryOf(filters: Filters): Omit<RevenueScheduleQuery, 'cursor'> {
  return {
    ...(filters.state === 'any' ? {} : { state: filters.state }),
    ...(filters.client ? { client: filters.client } : {}),
    ...(filters.contract ? { contract: filters.contract } : {}),
    ...(/^\d{4}-(0[1-9]|1[0-2])$/.test(filters.month) ? { month: filters.month } : {}),
  };
}

/**
 * `/revenue` (S06 "Screens"): the recognition schedules, filtered by client, contract, state and
 * a month they touch, with what each released and still holds in the selected ledger; and the
 * months, with their releases in both ledgers, their entries, the schedules missing a release
 * and the current month's preview. A banner counts the recognition decisions held in the inbox.
 */
export function RevenuePage() {
  const { view = 'schedules' } = route.useSearch();
  const navigate = useNavigate();
  const { companyId, me } = useCompany();
  const range = monthsEnding(currentMonth(), MONTHS);
  const months = useQuery(revenueMonthsQuery(companyId, range));
  const decisions = (months.data ?? []).reduce((count, month) => count + month.decisionCount, 0);
  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {decisions > 0 && (
        <Callout
          tone="warning"
          icon={<CircleAlertIcon />}
          title={
            <>
              {`${t.decisions.title}: `}
              <bdi dir="ltr">{decisions}</bdi>
            </>
          }
          description={
            <span className="flex flex-col gap-2">
              <span>{t.decisions.description}</span>
              {can(me, 'events.read') && (
                <span className="flex flex-wrap gap-2">
                  {(['SERVICE_PERIOD_CLOSED', 'NEEDS_DECISION'] as const).map((reason) => (
                    <Button
                      key={reason}
                      variant="outline"
                      size="sm"
                      aria-label={`${t.decisions.open}: ${ar.inbox.reasons[reason]}`}
                      render={<Link to="/inbox" search={{ view: 'held', reason }} />}
                    >
                      {ar.inbox.reasons[reason]}
                    </Button>
                  ))}
                </span>
              )}
            </span>
          }
        />
      )}
      <Tabs
        value={view}
        onValueChange={(next) =>
          void navigate({ to: '/revenue', search: { view: next as RevenueView }, replace: true })
        }
      >
        <TabsList aria-label={t.views.label}>
          {REVENUE_VIEWS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t.views[value]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="schedules" className="flex min-w-0 flex-col gap-4">
          {view === 'schedules' && <Schedules />}
        </TabsContent>
        <TabsContent value="months" className="flex min-w-0 flex-col gap-4">
          {view === 'months' && (
            <Months
              months={months.data}
              error={months.error}
              pending={months.isPending}
              refetch={() => void months.refetch()}
            />
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-row" />
      <Skeleton className="h-row" />
      <Skeleton className="h-row" />
    </div>
  );
}

function Failed({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <FormError error={error} />
      <Button variant="outline" onClick={retry}>
        <RotateCwIcon aria-hidden="true" />
        {ar.common.retry}
      </Button>
    </div>
  );
}

function Schedules() {
  const { contract } = route.useSearch();
  const { companyId } = useCompany();
  const catalog = useDimensionCatalog(companyId);
  const currencies = useLedgerCurrencies(companyId);
  // A contract named in the address (the contract position's link, S09) starts filtered to it.
  const [filters, setFilters] = useState<Filters>({ ...noFilters, contract: contract ?? null });
  const [ledger, setLedger] = useState<Ledger>('book');
  const list = useInfiniteQuery(revenueSchedulesQuery(companyId, queryOf(filters)));
  const rows = list.data?.pages.flatMap((page) => page.schedules) ?? [];
  const typeValues = (code: string) => {
    const type = catalog.types.find((candidate) => candidate.code === code);
    return type ? pickerValues(catalog.valuesOf(type.id)) : [];
  };
  const filtered = filters !== noFilters;
  const shown: Ledger = currencies.parallel ? ledger : 'book';

  return (
    <>
      <Card className="p-4">
        <search aria-label={t.filters.label}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <DimensionPicker
              label={t.filters.client}
              values={typeValues('client')}
              value={filters.client}
              labels={dimensionPickerLabels}
              onValueChange={(client) => setFilters({ ...filters, client })}
            />
            <DimensionPicker
              label={t.filters.contract}
              values={typeValues('contract')}
              value={filters.contract}
              labels={dimensionPickerLabels}
              onValueChange={(contract) => setFilters({ ...filters, contract })}
            />
            <SelectField
              label={t.filters.state}
              value={filters.state}
              options={stateOptions}
              onValueChange={(state) => setFilters({ ...filters, state })}
            />
            <div className="flex items-end gap-2">
              <Field className="min-w-0 flex-1">
                <FieldLabel>{t.filters.month}</FieldLabel>
                <Input
                  type="month"
                  dir="ltr"
                  value={filters.month}
                  onChange={(event) => setFilters({ ...filters, month: event.target.value })}
                />
              </Field>
              {filtered && (
                <Button variant="ghost" onClick={() => setFilters(noFilters)}>
                  <XIcon aria-hidden="true" />
                  {t.filters.clear}
                </Button>
              )}
            </div>
          </div>
        </search>
      </Card>
      <ReportLedgerSwitch companyId={companyId} value={ledger} onValueChange={setLedger} />
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <Failed error={list.error} retry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CalendarSearchIcon />}
          title={filtered ? t.empty.filtered : t.empty.title}
          description={filtered ? undefined : t.empty.description}
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          <Table aria-label={t.table.label}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.table.invoice}</TableHead>
                <TableHead className="max-sm:hidden">{t.table.client}</TableHead>
                <TableHead className="max-2xl:hidden">{t.table.contract}</TableHead>
                <TableHead className="max-2xl:hidden">{t.table.service}</TableHead>
                <TableHead className="max-md:hidden">{t.table.pattern}</TableHead>
                <TableHead className="max-md:hidden">{t.table.period}</TableHead>
                <TableHead numeric className="max-sm:hidden">
                  {t.table.amount}
                </TableHead>
                <TableHead numeric className="max-sm:hidden">
                  {t.table.released}
                </TableHead>
                <TableHead numeric>{t.table.remaining}</TableHead>
                <TableHead>{t.table.state}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((schedule) => (
                <TableRow key={schedule.id}>
                  <TableCell>
                    <ScheduleLink id={schedule.id} invoiceNumber={schedule.invoiceNumber} />
                  </TableCell>
                  <TableCell className="max-sm:hidden">
                    <ValueName value={schedule.client} />
                  </TableCell>
                  <TableCell className="max-2xl:hidden">
                    <ValueName value={schedule.contract} />
                  </TableCell>
                  <TableCell className="max-2xl:hidden">
                    <ValueName value={schedule.service} />
                  </TableCell>
                  <TableCell className="max-md:hidden">{t.patterns[schedule.pattern]}</TableCell>
                  <TableCell className="max-md:hidden">
                    <PeriodText schedule={schedule} />
                  </TableCell>
                  <TableCell numeric className="max-sm:hidden">
                    <Amount
                      value={BigInt(schedule.amountMinor)}
                      currency={schedule.currency}
                      showCurrency
                    />
                  </TableCell>
                  <TableCell numeric className="max-sm:hidden">
                    <LedgerAmount
                      amounts={schedule.released}
                      ledger={shown}
                      currencies={currencies}
                    />
                  </TableCell>
                  <TableCell numeric>
                    <LedgerAmount
                      amounts={schedule.remaining}
                      ledger={shown}
                      currencies={currencies}
                      strong
                    />
                  </TableCell>
                  <TableCell>
                    <ScheduleStateBadge state={schedule.state} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {list.hasNextPage && (
            <Button
              variant="outline"
              className="w-fit self-center"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t.loadMore}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

/** Why a month's release of a schedule is missing (S06 "Jobs"). */
function missingReason(reason: string | null): ReactNode {
  if (reason === null) return t.months.notRunYet;
  if (reason === 'PERIOD_CLOSED') return t.months.periodClosed;
  if (reason.startsWith('slot_unmapped:')) {
    return (
      <>
        {`${t.months.slotUnmapped}: `}
        {slotLabel(reason.slice('slot_unmapped:'.length))}
      </>
    );
  }
  if (reason.startsWith('account_blocked:')) {
    return (
      <>
        {`${t.months.accountBlocked}: `}
        <bdi dir="ltr">{reason.slice('account_blocked:'.length)}</bdi>
      </>
    );
  }
  return <bdi dir="ltr">{reason}</bdi>;
}

/** The last day of a `YYYY-MM` month. */
function lastDayOf(month: string): string {
  const [year, number] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return `${month}-${String(days).padStart(2, '0')}`;
}

function Months({
  months,
  error,
  pending,
  refetch,
}: {
  months: readonly RevenueMonth[] | undefined;
  error: unknown;
  pending: boolean;
  refetch: () => void;
}) {
  const { companyId, me } = useCompany();
  const currencies = useLedgerCurrencies(companyId);
  const [previewing, setPreviewing] = useState(false);
  const rows = [...(months ?? [])].reverse().slice(0, SHOWN_MONTHS);
  const entries = can(me, 'entries.read');
  return (
    <>
      <Button variant="outline" className="w-fit" onClick={() => setPreviewing(true)}>
        <CalendarSearchIcon aria-hidden="true" />
        {t.preview.open}
      </Button>
      {pending ? (
        <Loading />
      ) : error ? (
        <Failed error={error} retry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<CalendarSearchIcon />} title={t.months.empty} />
      ) : (
        <Table aria-label={t.months.label}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.months.month}</TableHead>
              <TableHead numeric>{t.months.releasedBook}</TableHead>
              {currencies.parallel && (
                <TableHead numeric className="max-sm:hidden">
                  {t.months.releasedParallel}
                </TableHead>
              )}
              <TableHead numeric className="max-md:hidden">
                {t.months.entries}
              </TableHead>
              <TableHead>{t.months.missing}</TableHead>
              <TableHead numeric className="max-md:hidden">
                {t.months.decisions}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((month) => (
              <TableRow key={month.month}>
                <TableCell>{formatMonth(month.month)}</TableCell>
                <TableCell numeric>
                  {currencies.book && (
                    <Amount value={BigInt(month.releasedBookMinor)} currency={currencies.book} />
                  )}
                </TableCell>
                {currencies.parallel && (
                  <TableCell numeric className="max-sm:hidden">
                    {month.releasedParallelMinor !== null && (
                      <Amount
                        value={BigInt(month.releasedParallelMinor)}
                        currency={currencies.parallel}
                      />
                    )}
                  </TableCell>
                )}
                <TableCell numeric className="max-md:hidden">
                  {entries && month.entryCount > 0 ? (
                    <Link
                      to="/entries"
                      search={{
                        source: 'revenue_release',
                        from: `${month.month}-01`,
                        to: lastDayOf(month.month),
                      }}
                      aria-label={`${t.months.openEntries}: ${month.month}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      <bdi dir="ltr">{month.entryCount}</bdi>
                    </Link>
                  ) : (
                    <bdi dir="ltr">{month.entryCount}</bdi>
                  )}
                </TableCell>
                <TableCell className="min-w-48 whitespace-normal">
                  {month.missing.length === 0 ? (
                    <span className="text-muted-foreground">{t.months.missingNone}</span>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {month.missing.map((missing) => (
                        <li key={missing.scheduleId} className="flex flex-col">
                          <ScheduleLink
                            id={missing.scheduleId}
                            invoiceNumber={missing.invoiceNumber}
                          />
                          <span className="text-xs text-muted-foreground">
                            {missingReason(missing.reason)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
                <TableCell numeric className="max-md:hidden">
                  <bdi dir="ltr">{month.decisionCount}</bdi>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <PreviewDialog open={previewing} onOpenChange={setPreviewing} />
    </>
  );
}

/** "معاينة الشهر الجاري": the releases the job would post at the month's end. */
function PreviewDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { companyId } = useCompany();
  const currencies = useLedgerCurrencies(companyId);
  const month = currentMonth();
  const preview = useQuery({ ...revenuePreviewQuery(companyId, month), enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={ar.common.close} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {`${t.preview.title}: `}
            {formatMonth(month)}
          </DialogTitle>
          <DialogDescription>{t.preview.description}</DialogDescription>
        </DialogHeader>
        {preview.isPending ? (
          <Loading />
        ) : preview.isError ? (
          <Failed error={preview.error} retry={() => void preview.refetch()} />
        ) : preview.data.entries.length === 0 ? (
          <p className="text-muted-foreground">{t.preview.empty}</p>
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            {preview.data.entries.map((entry) => (
              <section
                key={entry.inboxId}
                aria-label={`${t.preview.invoice} ${entry.invoiceNumber}`}
                className="flex min-w-0 flex-col gap-2"
              >
                <p className="flex flex-wrap items-center gap-x-3">
                  <ListIcon aria-hidden="true" className="size-icon text-muted-foreground" />
                  <bdi dir="ltr" className="font-medium">
                    {entry.invoiceNumber}
                  </bdi>
                  <span className="text-muted-foreground">
                    {`${t.preview.date}: `}
                    {formatDay(entry.date)}
                  </span>
                </p>
                <Table aria-label={`${t.preview.invoice} ${entry.invoiceNumber}`}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.preview.client}</TableHead>
                      <TableHead className="max-sm:hidden">{t.preview.service}</TableHead>
                      <TableHead numeric>{t.preview.book}</TableHead>
                      {currencies.parallel && <TableHead numeric>{t.preview.parallel}</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entry.lines.map((line) => (
                      <TableRow key={line.scheduleId}>
                        <TableCell>
                          <ScheduleLink id={line.scheduleId} invoiceNumber={entry.invoiceNumber} />
                          <span className="block text-xs text-muted-foreground">
                            <ValueName value={line.client} />
                          </span>
                        </TableCell>
                        <TableCell className="max-sm:hidden">
                          <ValueName value={line.service} />
                        </TableCell>
                        <TableCell numeric>
                          <LedgerAmount
                            amounts={line.amounts}
                            ledger="book"
                            currencies={currencies}
                          />
                        </TableCell>
                        {currencies.parallel && (
                          <TableCell numeric>
                            <LedgerAmount
                              amounts={line.amounts}
                              ledger="parallel"
                              currencies={currencies}
                            />
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
