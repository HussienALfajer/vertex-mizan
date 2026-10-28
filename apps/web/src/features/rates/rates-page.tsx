import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import {
  CURRENCY_CODES,
  type CurrencyCode,
  createRatePairSchema,
  type RateCalendar,
  type RateInForce,
  type RatePair,
  type RateRow,
  type RateType,
  type RecordedRate,
  rateInForceSchema,
  ratePairSchema,
  recordedRateSchema,
  recordRateSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  RateInput,
  SelectField,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
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
  Textarea,
} from '@vertex-mizan/ui';
import {
  CalendarDaysIcon,
  CircleCheckIcon,
  InfoIcon,
  PlusIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { ApiError, api, hasCode } from '../../lib/api';
import {
  addDays,
  damascusToday,
  formatDateTime,
  formatDay,
  formatShortDay,
  isoWeekday,
} from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { EntryNumberText, useFiscalYearStartMonth } from '../entries/entry-parts';
import { rateEntriesQuery } from '../entries/entry-queries';
import { rateCalendarQuery, ratePairsQuery, ratesQuery } from './rate-queries';

const t = ar.rates;
const currencies = ar.accounting.currencies;
const route = getRouteApi('/_app/_company/rates/');

const RATE_TYPES_SHOWN = ['bulletin', 'market'] as const satisfies readonly RateType[];
const currencyOptions = CURRENCY_CODES.map((code) => ({
  value: code,
  label: `${code} · ${currencies[code]}`,
}));
const pairLabel = (pair: { base: CurrencyCode; quote: CurrencyCode }) =>
  `${pair.base} / ${pair.quote}`;

/** A rate as quoted: `1 USD = 120 SYP`, left to right. */
function QuotedRate({ row, strong = false }: { row: RateRow; strong?: boolean }) {
  return (
    <bdi dir="ltr" className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>
      {`1 ${row.base} = ${row.rate} ${row.quote}`}
    </bdi>
  );
}

/**
 * `/rates` (S02 rules 14–18): a pair's rates of each type, newest first, with their source,
 * recorder and corrections; the bulletin's status over the last 30 days; the rate in force on a
 * date. Owners and accountants record a bulletin or a market rate (a second rate for a date is a
 * correction with a reason) and add pairs; every role reads them.
 */
export function RatesPage() {
  const { companyId, me, membership } = useCompany();
  const manage = can(me, 'rates.manage') && !membership.company.archived;
  const { record: recordFromPalette } = route.useSearch();
  const navigate = useNavigate();
  const pairs = useQuery(ratePairsQuery(companyId));
  // By currencies, not id: a pair a first rate creates is chosen once the list has it.
  const [pairKey, setPairKey] = useState<string | null>(null);
  const [type, setType] = useState<RateType>('bulletin');
  const [recording, setRecording] = useState<RateType | null>(null);
  const [addingPair, setAddingPair] = useState(false);
  const [notice, setNotice] = useState<RecordedRate | null>(null);
  const pair = pairs.data?.find((candidate) => pairLabel(candidate) === pairKey) ?? pairs.data?.[0];
  const recordType = recording ?? (recordFromPalette && manage ? recordFromPalette : null);
  const closeRecord = () => {
    setRecording(null);
    if (recordFromPalette) void navigate({ to: '/rates', search: {}, replace: true });
  };

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          <div className="flex flex-wrap gap-2">
            {manage && (
              <>
                <Button onClick={() => setRecording('bulletin')}>
                  <PlusIcon aria-hidden="true" />
                  {t.recordBulletin}
                </Button>
                <Button variant="outline" onClick={() => setRecording('market')}>
                  {t.recordMarket}
                </Button>
                <Button variant="outline" onClick={() => setAddingPair(true)}>
                  {t.newPair}
                </Button>
              </>
            )}
            <Button variant="outline" render={<Link to="/rates/calendar" />}>
              <CalendarDaysIcon aria-hidden="true" />
              {t.calendarLink}
            </Button>
          </div>
        }
      />
      {!can(me, 'rates.manage') && <Callout tone="info" icon={<InfoIcon />} title={t.readOnly} />}
      {notice && <RecordedNotice recorded={notice} />}
      {pairs.isPending ? (
        <Loading />
      ) : pairs.isError ? (
        <FormError error={pairs.error} />
      ) : !pair ? (
        <EmptyState
          icon={<CalendarDaysIcon />}
          title={t.empty.title}
          description={t.empty.description}
        />
      ) : (
        <>
          <div className="max-w-xs">
            <SelectField
              label={t.pair}
              value={pairLabel(pair)}
              options={(pairs.data ?? []).map((candidate) => ({
                value: pairLabel(candidate),
                label: pairLabel(candidate),
              }))}
              onValueChange={setPairKey}
            />
          </div>
          <Tabs value={type} onValueChange={(value) => setType(value as RateType)}>
            <TabsList aria-label={t.type}>
              {RATE_TYPES_SHOWN.map((value) => (
                <TabsTrigger key={value} value={value}>
                  {t.types[value]}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={type}>
              <PairPanel key={`${pair.id}-${type}`} pair={pair} type={type} />
            </TabsContent>
          </Tabs>
        </>
      )}
      {recordType && (
        <RecordDialog
          key={recordType}
          type={recordType}
          pair={pair}
          onClose={closeRecord}
          onRecorded={(recorded) => {
            setNotice(recorded);
            setType(recorded.rate.type);
            setPairKey(pairLabel(recorded.rate));
          }}
        />
      )}
      {addingPair && (
        <PairDialog
          onClose={() => setAddingPair(false)}
          onAdded={(added) => setPairKey(pairLabel(added))}
        />
      )}
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

/** After a rate is recorded: the row, and for a correction the row it superseded (rule 15). */
function RecordedNotice({ recorded }: { recorded: RecordedRate }) {
  return (
    <Callout
      role="status"
      tone="info"
      icon={<CircleCheckIcon />}
      title={recorded.superseded ? t.record.corrected : t.record.recorded}
      description={
        <span className="flex flex-wrap gap-x-3">
          {recorded.superseded && (
            <span>
              <QuotedRate row={recorded.superseded} /> ← <QuotedRate row={recorded.rate} strong />
            </span>
          )}
          {!recorded.superseded && <QuotedRate row={recorded.rate} strong />}
          <span>{formatDay(recorded.rate.effectiveOn)}</span>
        </span>
      }
    />
  );
}

function PairPanel({ pair, type }: { pair: RatePair; type: RateType }) {
  const { companyId, me } = useCompany();
  const [usedBy, setUsedBy] = useState<RateRow | null>(null);
  const rows = useInfiniteQuery(ratesQuery(companyId, pair, type));
  const list = rows.data?.pages.flatMap((page) => page.rates) ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {type === 'bulletin' && <BulletinStatus pair={pair} />}
      <InForce pair={pair} type={type} />
      {rows.isPending ? (
        <Loading />
      ) : rows.isError ? (
        <FormError error={rows.error} />
      ) : list.length === 0 ? (
        <EmptyState title={t.empty.rows} />
      ) : (
        <>
          <Table aria-label={`${t.table.label}: ${pairLabel(pair)} · ${t.types[type]}`}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.table.effectiveOn}</TableHead>
                <TableHead numeric>{t.table.rate}</TableHead>
                <TableHead className="max-md:hidden">{t.table.source}</TableHead>
                <TableHead className="max-lg:hidden">{t.table.recordedBy}</TableHead>
                <TableHead className="max-lg:hidden">{t.table.recordedAt}</TableHead>
                <TableHead>{t.table.status}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((row) => (
                <TableRow key={row.id} className={row.superseded ? 'text-muted-foreground' : ''}>
                  <TableCell>{formatDay(row.effectiveOn)}</TableCell>
                  <TableCell numeric>
                    <bdi dir="ltr" className={row.superseded ? 'line-through' : 'font-medium'}>
                      {row.rate}
                    </bdi>
                  </TableCell>
                  <TableCell className="max-md:hidden">{t.sources[row.source]}</TableCell>
                  <TableCell className="max-lg:hidden">
                    <bdi>{row.recordedBy.name}</bdi>
                  </TableCell>
                  <TableCell className="max-lg:hidden">{formatDateTime(row.createdAt)}</TableCell>
                  <TableCell>
                    <span className="flex flex-col items-start gap-1">
                      {row.superseded && <Badge tone="neutral">{t.table.superseded}</Badge>}
                      {row.supersedesRateId && (
                        <Badge tone="info" title={row.reason ?? undefined}>
                          {t.table.correction}
                        </Badge>
                      )}
                      {row.reason && (
                        <span className="text-muted-foreground text-xs">
                          {`${t.table.reason}: `}
                          <bdi>{row.reason}</bdi>
                        </span>
                      )}
                      {can(me, 'entries.read') && (
                        <Button variant="ghost" size="sm" onClick={() => setUsedBy(row)}>
                          {ar.entries.rateEntries.open}
                        </Button>
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.hasNextPage && (
            <Button
              variant="outline"
              className="w-fit self-center"
              loading={rows.isFetchingNextPage}
              onClick={() => void rows.fetchNextPage()}
            >
              {t.loadMore}
            </Button>
          )}
        </>
      )}
      <RateEntriesSheet row={usedBy} onClose={() => setUsedBy(null)} />
    </div>
  );
}

/**
 * The entries whose conversions used a rate row (S02 rule 15, S03): after a correction they stay
 * as posted; each opens, to be reversed and posted again (S03 rule 9).
 */
function RateEntriesSheet({ row, onClose }: { row: RateRow | null; onClose: () => void }) {
  const { companyId } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const entries = useInfiniteQuery({
    ...rateEntriesQuery(companyId, row?.id ?? ''),
    enabled: row !== null,
  });
  const list = entries.data?.pages.flatMap((page) => page.entries) ?? [];
  const te = ar.entries;
  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-4 overflow-y-auto p-6">
        <SheetTitle>{te.rateEntries.title}</SheetTitle>
        {row && (
          <p className="flex flex-wrap gap-x-3">
            <QuotedRate row={row} strong />
            <span>{formatDay(row.effectiveOn)}</span>
          </p>
        )}
        <p className="text-muted-foreground">{te.rateEntries.description}</p>
        {entries.isPending ? (
          <Loading />
        ) : entries.isError ? (
          <FormError error={entries.error} />
        ) : list.length === 0 ? (
          <EmptyState title={te.rateEntries.empty} />
        ) : (
          <ul aria-label={te.rateEntries.title} className="flex flex-col gap-2">
            {list.map((entry) => (
              <li key={entry.id} className="flex flex-col">
                <Link
                  to="/entries/$id"
                  params={{ id: entry.id }}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  <EntryNumberText number={entry} startMonth={startMonth} />
                </Link>
                <span className="text-muted-foreground text-xs">
                  {`${formatDay(entry.entryDate)} · `}
                  <bdi>{entry.description}</bdi>
                </span>
              </li>
            ))}
          </ul>
        )}
        {entries.hasNextPage && (
          <Button
            variant="outline"
            className="w-fit"
            loading={entries.isFetchingNextPage}
            onClick={() => void entries.fetchNextPage()}
          >
            {t.loadMore}
          </Button>
        )}
        <SheetClose render={<Button variant="secondary" className="w-fit" />}>
          {ar.common.close}
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}

type DayStatus = 'recorded' | 'dayOff' | 'holiday' | 'missing';

const statusTone = {
  recorded: 'success',
  dayOff: 'neutral',
  holiday: 'outline',
  missing: 'danger',
} as const satisfies Record<DayStatus, string>;

/**
 * Each of the last 30 days (rule 16): a bulletin recorded for it, a weekly day off, a holiday, or
 * a publication day without its bulletin. The status is written out, never shown by color alone.
 */
export function bulletinDays(
  today: string,
  calendar: RateCalendar,
  recordedDays: ReadonlySet<string>,
): { day: string; status: DayStatus }[] {
  const holidays = new Set(calendar.holidays.map((holiday) => holiday.on));
  return Array.from({ length: 30 }, (_, index) => {
    const day = addDays(today, index - 29);
    const status: DayStatus = recordedDays.has(day)
      ? 'recorded'
      : holidays.has(day)
        ? 'holiday'
        : calendar.daysOff.includes(isoWeekday(day))
          ? 'dayOff'
          : 'missing';
    return { day, status };
  }).reverse();
}

function BulletinStatus({ pair }: { pair: RatePair }) {
  const { companyId } = useCompany();
  const today = damascusToday();
  const calendar = useQuery(rateCalendarQuery(companyId));
  const rows = useInfiniteQuery(
    ratesQuery(companyId, pair, 'bulletin', { from: addDays(today, -29), to: today }),
  );
  // A day is judged missing only once every page is read: corrections can fill the first page.
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = rows;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage]);
  const complete = rows.data !== undefined && !hasNextPage;
  const recorded = new Set(
    rows.data?.pages.flatMap((page) => page.rates.map((r) => r.effectiveOn)),
  );
  const days = calendar.data ? bulletinDays(today, calendar.data, recorded) : [];
  const missing = days.filter((entry) => entry.status === 'missing').length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.status.title}</CardTitle>
        <CardDescription>
          {calendar.data && complete ? (
            missing === 0 ? (
              t.status.allRecorded
            ) : (
              <span className="flex items-center gap-2 text-destructive-text">
                <TriangleAlertIcon aria-hidden="true" className="size-icon" />
                {`${t.status.missingCount}: `}
                <bdi dir="ltr">{`${missing}`}</bdi>
              </span>
            )
          ) : null}
        </CardDescription>
      </CardHeader>
      <div className="px-6 pb-6">
        {calendar.isError || rows.isError ? (
          <FormError error={calendar.error ?? rows.error} />
        ) : calendar.isPending || !complete ? (
          <Skeleton className="h-row" />
        ) : (
          <ul aria-label={t.status.label} className="flex flex-wrap gap-2">
            {days.map(({ day, status }) => (
              <li key={day}>
                <Badge tone={statusTone[status]}>
                  {status === 'missing' && <TriangleAlertIcon aria-hidden="true" />}
                  <span>{formatShortDay(day)}</span>
                  <span>· {t.status[status]}</span>
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/** The rate in force for the pair and type on a date (rule 16), or why there is none. */
function InForce({ pair, type }: { pair: RatePair; type: RateType }) {
  const { companyId } = useCompany();
  const [on, setOn] = useState(damascusToday());
  const [asked, setAsked] = useState<string | null>(null);
  const answer = useQuery({
    queryKey: ['rates', companyId, 'in-force', pair.base, pair.quote, type, asked],
    queryFn: () =>
      api(
        'GET',
        `/rates/in-force?${new URLSearchParams({ type, from: pair.base, to: pair.quote, on: asked ?? '' })}`,
        {
          company: companyId,
          schema: rateInForceSchema,
        },
      ),
    enabled: asked !== null,
    retry: false,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.inForce.title}</CardTitle>
        <CardDescription>{t.inForce.description}</CardDescription>
      </CardHeader>
      <form
        className="flex flex-col gap-4 px-6 pb-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (on !== '') setAsked(on);
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <Field className="w-48">
            <FieldLabel>{t.inForce.on}</FieldLabel>
            <Input
              type="date"
              dir="ltr"
              value={on}
              onChange={(event) => setOn(event.target.value)}
            />
          </Field>
          <Button type="submit" variant="outline" loading={answer.isFetching}>
            {t.inForce.ask}
          </Button>
        </div>
        {asked !== null && answer.data && <InForceAnswer answer={answer.data} />}
        {asked !== null && answer.error && <InForceMissing error={answer.error} />}
      </form>
    </Card>
  );
}

function InForceAnswer({ answer }: { answer: RateInForce }) {
  return (
    <div role="status" className="flex flex-col gap-1">
      {answer.rows.map((row) => (
        <p key={row.id} className="flex flex-wrap items-baseline gap-x-3">
          <QuotedRate row={row} strong />
          <span className="text-muted-foreground">
            {`${t.inForce.effectiveOn} ${formatDay(row.effectiveOn)} · ${t.sources[row.source]}`}
          </span>
        </p>
      ))}
      {answer.via && (
        <p className="text-muted-foreground">
          {`${t.inForce.via} `}
          <bdi dir="ltr">{answer.via}</bdi>
        </p>
      )}
    </div>
  );
}

function InForceMissing({ error }: { error: unknown }) {
  if (!hasCode(error, 'RATE_MISSING')) return <FormError error={error} />;
  const publicationDay = error instanceof ApiError ? error.details?.publicationDay : undefined;
  return (
    <Callout
      role="status"
      tone="warning"
      icon={<TriangleAlertIcon />}
      title={t.inForce.missing}
      description={
        publicationDay ? `${t.inForce.missingBulletin}: ${formatDay(publicationDay)}` : undefined
      }
    />
  );
}

/**
 * A manual rate of either type (rules 14–15). When the pair, type and date already have a rate the
 * API asks for a reason (`RATE_REASON_REQUIRED`): the dialog says the new rate corrects the old one
 * and sends it again with the reason.
 */
function RecordDialog({
  type: initialType,
  pair,
  onClose,
  onRecorded,
}: {
  type: RateType;
  pair: RatePair | undefined;
  onClose: () => void;
  onRecorded: (recorded: RecordedRate) => void;
}) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const [type, setType] = useState<RateType>(initialType);
  const [base, setBase] = useState<CurrencyCode>(pair?.base ?? 'USD');
  const [quote, setQuote] = useState<CurrencyCode>(pair?.quote ?? 'SYP');
  const [effectiveOn, setEffectiveOn] = useState(damascusToday());
  const [rate, setRate] = useState<string | null>(null);
  const [rateInvalid, setRateInvalid] = useState(false);
  // Enter in the rate field commits it and submits the form in one keystroke, before a render:
  // the submit reads the committed rate from here.
  const committed = useRef<{ rate: string | null; invalid: boolean }>({
    rate: null,
    invalid: false,
  });
  const [correction, setCorrection] = useState(false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{
    rate?: string;
    pair?: string;
    date?: string;
    reason?: string;
  }>({});
  const [attempt, setAttempt] = useState(0);
  const save = useMutation({
    mutationFn: (body: unknown) =>
      api('POST', '/rates', { company: companyId, body, schema: recordedRateSchema }),
    onSuccess: async (recorded) => {
      await queryClient.invalidateQueries({ queryKey: ['rates', companyId] });
      onRecorded(recorded);
      onClose();
    },
    onError: (error) => {
      if (hasCode(error, 'RATE_REASON_REQUIRED')) setCorrection(true);
    },
  });
  // Changing what the rate is for drops the correction question: the API asks again if needed.
  const change = (apply: () => void) => {
    apply();
    setCorrection(false);
    save.reset();
  };

  function submit() {
    const found: typeof errors = {};
    if (committed.current.rate === null || committed.current.invalid) {
      found.rate = t.record.rateInvalid;
    }
    if (base === quote) found.pair = t.validation.samePair;
    if (effectiveOn === '') found.date = t.validation.required;
    if (correction && (reason.trim() === '' || reason.trim().length > 500)) {
      found.reason = t.validation.reason;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setAttempt((count) => count + 1);
      return;
    }
    const parsed = recordRateSchema.safeParse({
      effectiveOn,
      base,
      quote,
      rate: committed.current.rate,
      type,
      source: 'manual',
      ...(correction ? { reason } : {}),
    });
    if (!parsed.success) {
      setErrors({ date: ar.errors.SYP_BEFORE_REDENOMINATION });
      setAttempt((count) => count + 1);
      return;
    }
    save.mutate(parsed.data);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={ar.common.close}>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {type === 'bulletin' ? t.record.bulletinTitle : t.record.marketTitle}
            </DialogTitle>
            <DialogDescription>{t.record.description}</DialogDescription>
          </DialogHeader>
          <FormErrorSummary
            attempt={attempt}
            errors={[
              ['rate-quote', errors.pair],
              ['rate-date', errors.date],
              ['rate-value', errors.rate],
              ['rate-reason', errors.reason],
            ]}
          />
          <SelectField
            label={t.type}
            value={type}
            options={RATE_TYPES_SHOWN.map((value) => ({ value, label: t.types[value] }))}
            onValueChange={(value) => change(() => setType(value))}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={t.record.base}
              value={base}
              options={currencyOptions}
              onValueChange={(value) => change(() => setBase(value))}
            />
            <SelectField
              id="rate-quote"
              label={t.record.quote}
              value={quote}
              options={currencyOptions}
              error={errors.pair}
              onValueChange={(value) => change(() => setQuote(value))}
            />
          </div>
          <Field id="rate-date" invalid={errors.date !== undefined}>
            <FieldLabel>{t.record.effectiveOn}</FieldLabel>
            <Input
              type="date"
              dir="ltr"
              value={effectiveOn}
              onChange={(event) => change(() => setEffectiveOn(event.target.value))}
            />
            <FieldError match={errors.date !== undefined}>{errors.date}</FieldError>
          </Field>
          <Field id="rate-value" invalid={errors.rate !== undefined || rateInvalid}>
            <FieldLabel>{t.record.rate}</FieldLabel>
            <RateInput
              value={rate}
              onValueChange={(value) =>
                change(() => {
                  committed.current.rate = value;
                  setRate(value);
                })
              }
              onTextError={(invalid) => {
                committed.current.invalid = invalid;
                setRateInvalid(invalid);
              }}
            />
            <FieldDescription>{t.record.rateHint}</FieldDescription>
            <FieldError match={errors.rate !== undefined || rateInvalid}>
              {t.record.rateInvalid}
            </FieldError>
          </Field>
          {correction && (
            <>
              <Callout
                tone="warning"
                icon={<TriangleAlertIcon />}
                title={t.record.correctionTitle}
                description={t.record.correctionDescription}
              />
              <Field id="rate-reason" invalid={errors.reason !== undefined}>
                <FieldLabel>{t.record.reason}</FieldLabel>
                <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
                <FieldError match={errors.reason !== undefined}>{errors.reason}</FieldError>
              </Field>
            </>
          )}
          <FormError error={hasCode(save.error, 'RATE_REASON_REQUIRED') ? null : save.error} />
          <DialogFooter>
            <Button type="submit" loading={save.isPending}>
              {correction ? t.record.correct : t.record.submit}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              {ar.common.cancel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A pair with its one orientation (ADR 0011); the reverse of a held pair is `RATE_ORIENTATION`. */
function PairDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (pair: RatePair) => void;
}) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const [base, setBase] = useState<CurrencyCode>('USD');
  const [quote, setQuote] = useState<CurrencyCode>('SYP');
  const [invalid, setInvalid] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const add = useMutation({
    mutationFn: (body: unknown) =>
      api('POST', '/rate-pairs', { company: companyId, body, schema: ratePairSchema }),
    onSuccess: async (pair) => {
      await queryClient.invalidateQueries({ queryKey: ['rates', companyId, 'pairs'] });
      onAdded(pair);
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={ar.common.close}>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = createRatePairSchema.safeParse({ base, quote });
            setInvalid(!parsed.success);
            if (parsed.success) add.mutate(parsed.data);
            else setAttempt((count) => count + 1);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.pairDialog.title}</DialogTitle>
            <DialogDescription>{t.pairDialog.description}</DialogDescription>
          </DialogHeader>
          <FormErrorSummary
            attempt={attempt}
            errors={[['pair-quote', invalid ? t.validation.samePair : undefined]]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={t.record.base}
              value={base}
              options={currencyOptions}
              onValueChange={setBase}
            />
            <SelectField
              id="pair-quote"
              label={t.record.quote}
              value={quote}
              options={currencyOptions}
              error={invalid ? t.validation.samePair : undefined}
              onValueChange={setQuote}
            />
          </div>
          <FormError error={add.error} />
          <DialogFooter>
            <Button type="submit" loading={add.isPending}>
              {t.pairDialog.submit}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              {ar.common.cancel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
