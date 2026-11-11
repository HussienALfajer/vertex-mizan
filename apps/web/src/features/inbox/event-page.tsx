import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import {
  type InboxAction,
  type InboxEventDetail,
  inboxEventDetailSchema,
  resolveEventSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Button,
  Callout,
  Card,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Digest,
  EmptyState,
  EntryPicker,
  type EntryPickerOption,
  Field,
  FieldError,
  FieldLabel,
  JsonViewer,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@vertex-mizan/ui';
import {
  BanIcon,
  CalendarArrowUpIcon,
  CalendarCheckIcon,
  CirclePauseIcon,
  FilePenLineIcon,
  FileQuestionIcon,
  InfoIcon,
  ListIcon,
  RotateCwIcon,
  SplitIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { ReasonDialog } from '../../components/reason-dialog';
import { api, hasCode } from '../../lib/api';
import { formatDateTime, formatDay, formatEntryNumber, parseEntryNumber } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { Fact, useFiscalYearStartMonth } from '../entries/entry-parts';
import { entriesQuery } from '../entries/entry-queries';
import { ActionPreviewPanel } from '../revenue/action-preview';
import { SplitDialog } from '../revenue/split-dialog';
import {
  actionLabel,
  detailText,
  EntryLinks,
  EventStateText,
  InboxBackLink,
  reasonLabel,
  typeLabel,
} from './inbox-parts';
import { inboxEventQuery } from './inbox-queries';
import { KeyFields } from './key-fields';

const t = ar.inbox;
const route = getRouteApi('/_app/_company/inbox/$id');

type Action = 'move' | 'resolve' | 'dismiss' | 'recognise' | 'split';

/**
 * `/inbox/:id` (S05 "Screens", rules 15–18): the event's envelope, its key fields with `Amount`
 * and its payload as received, the hold with what fixes it and the event it waits for, its history
 * and its entries. A held event is retried, moved to the next open period (`PERIOD_CLOSED`) or
 * resolved by a posted manual entry (`NEEDS_DECISION`) with `events.manage`, and dismissed by the
 * owner (`events.dismiss`); the auditor reads only.
 */
export function EventPage() {
  const { id } = route.useParams();
  const { companyId, me, membership } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const queryClient = useQueryClient();
  const event = useQuery(inboxEventQuery(companyId, id));
  const [open, setOpen] = useState<Action | null>(null);
  const updated = (next: InboxEventDetail) => {
    queryClient.setQueryData(inboxEventQuery(companyId, id).queryKey, next);
    // The lists and the count change; this event's answer is the one just set.
    void queryClient.invalidateQueries({ queryKey: ['inbox', companyId, 'list'] });
    void queryClient.invalidateQueries({ queryKey: ['inbox', companyId, 'counts'] });
    void queryClient.invalidateQueries({ queryKey: ['entries', companyId] });
    // What an action would have posted no longer holds; the schedules changed with it (S06).
    queryClient.removeQueries({ queryKey: ['inbox', companyId, 'preview', id] });
    void queryClient.invalidateQueries({ queryKey: ['revenue', companyId] });
  };
  const retry = useMutation({
    mutationFn: () =>
      api('POST', `/inbox/${id}/retry`, { company: companyId, schema: inboxEventDetailSchema }),
    onSuccess: updated,
  });

  if (hasCode(event.error, 'NOT_FOUND') || hasCode(event.error, 'VALIDATION_FAILED')) {
    return (
      <>
        <InboxBackLink />
        <EmptyState icon={<FileQuestionIcon />} title={t.event.notFound} />
      </>
    );
  }
  if (event.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-control w-64" />
        <Skeleton className="h-row" />
        <Skeleton className="h-row" />
      </div>
    );
  }
  if (event.isError) return <FormError error={event.error} />;
  const data = event.data;
  const held = data.state === 'held';
  const active = !membership.company.archived;
  const manage = held && active && can(me, 'events.manage');
  // The actions of S06 rule 16, each previewed on the page and in its dialog.
  const recognisable = held && data.reason === 'SERVICE_PERIOD_CLOSED';
  const splittable =
    held &&
    data.reason === 'NEEDS_DECISION' &&
    (data.detail === 'cancelled_project_remainder' ||
      data.detail === 'invoiced_after_cancellation');
  const dismiss = held && active && can(me, 'events.dismiss');
  const action = (path: string, body: object) =>
    api('POST', `/inbox/${id}/${path}`, {
      company: companyId,
      body,
      schema: inboxEventDetailSchema,
    }).then(updated);

  return (
    <>
      <PageHeader
        back={<InboxBackLink />}
        title={
          <span className="flex flex-wrap items-center gap-x-3">
            {typeLabel(data.type)}
            {data.documentNumber && <bdi dir="ltr">{data.documentNumber}</bdi>}
          </span>
        }
        description={<EventStateText state={data.state} reason={data.reason} />}
        actions={
          (manage || dismiss) && (
            <div className="flex flex-wrap gap-2">
              {manage && (
                <Button variant="outline" loading={retry.isPending} onClick={() => retry.mutate()}>
                  <RotateCwIcon aria-hidden="true" />
                  {t.retryAction.label}
                </Button>
              )}
              {manage && data.reason === 'PERIOD_CLOSED' && (
                <Button variant="outline" onClick={() => setOpen('move')}>
                  <CalendarArrowUpIcon aria-hidden="true" />
                  {t.move.label}
                </Button>
              )}
              {manage && recognisable && (
                <Button variant="outline" onClick={() => setOpen('recognise')}>
                  <CalendarCheckIcon aria-hidden="true" />
                  {ar.revenue.actions.recognise.label}
                </Button>
              )}
              {manage && splittable && (
                <Button variant="outline" onClick={() => setOpen('split')}>
                  <SplitIcon aria-hidden="true" />
                  {ar.revenue.actions.split.label}
                </Button>
              )}
              {manage && data.reason === 'NEEDS_DECISION' && (
                <Button variant="outline" onClick={() => setOpen('resolve')}>
                  <FilePenLineIcon aria-hidden="true" />
                  {t.resolve.label}
                </Button>
              )}
              {dismiss && (
                <Button variant="outline" onClick={() => setOpen('dismiss')}>
                  <BanIcon aria-hidden="true" />
                  {t.dismiss.label}
                </Button>
              )}
            </div>
          )
        }
      />
      <FormError error={retry.error} />
      {held && <Hold event={data} />}
      {held && !can(me, 'events.manage') && (
        <Callout tone="info" icon={<InfoIcon />} title={t.event.readOnly} />
      )}
      {recognisable && (
        <Section id="event-closed-parts" title={ar.revenue.actions.recognise.closedParts}>
          <ActionPreviewPanel id={id} query={{ action: 'recognise-in-open-period' }} />
        </Section>
      )}
      {splittable && (
        <Section id="event-remainder" title={ar.inbox.details.cancelled_project_remainder}>
          <p className="text-muted-foreground">{ar.revenue.actions.split.wholeRefunded}</p>
          <ActionPreviewPanel id={id} query={{ action: 'split-remainder', revenueAmount: '0' }} />
        </Section>
      )}
      <Card className="p-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t.event.hubId}>
            <Digest
              value={data.eventId}
              copyLabel={t.event.copyHash}
              copiedLabel={t.event.copied}
            />
          </Fact>
          <Fact label={t.event.typeCode}>
            <bdi dir="ltr">{data.type}</bdi>
          </Fact>
          <Fact label={t.event.version}>
            <bdi dir="ltr">{data.version}</bdi>
          </Fact>
          <Fact label={t.event.document}>
            {ar.inbox.documentTypes[data.documentType]}
            {data.documentNumber && (
              <>
                {' '}
                <bdi dir="ltr">{data.documentNumber}</bdi>
              </>
            )}
          </Fact>
          <Fact label={t.event.accountingDate}>{formatDay(data.accountingDate)}</Fact>
          {data.postedOn && <Fact label={t.event.postedOn}>{formatDay(data.postedOn)}</Fact>}
          <Fact label={t.event.occurredAt}>{formatDateTime(data.occurredAt)}</Fact>
          <Fact label={t.event.receivedAt}>{formatDateTime(data.receivedAt)}</Fact>
          <Fact label={t.event.attempts}>
            <bdi dir="ltr">{data.attempts}</bdi>
          </Fact>
          <Fact label={t.event.lastAttemptAt}>{formatDateTime(data.lastAttemptAt)}</Fact>
          <Fact label={t.event.payloadHash}>
            <Digest
              value={data.payloadHash}
              copyLabel={t.event.copyHash}
              copiedLabel={t.event.copied}
            />
          </Fact>
          <Fact label={t.event.requestId}>
            <bdi dir="ltr" className="break-all">
              {data.requestId}
            </bdi>
          </Fact>
        </dl>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t.event.keyFields}</CardTitle>
        </CardHeader>
        <div className="px-6 pb-6">
          <KeyFields
            type={data.type}
            version={data.version}
            payload={data.payload}
            fallback={<p className="text-muted-foreground">{t.event.keyFieldsUnknown}</p>}
          />
        </div>
      </Card>
      <Section id="event-entries" title={t.event.entries}>
        {data.resolvedBy ? (
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">{t.event.resolvedBy}</span>
            <EntryLinks entries={[data.resolvedBy]} startMonth={startMonth} />
          </p>
        ) : data.entries.length > 0 ? (
          <EntryLinks entries={data.entries} startMonth={startMonth} />
        ) : (
          <p className="text-muted-foreground">{t.event.entriesEmpty}</p>
        )}
        {data.documentNumber && (
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            render={<Link to="/inbox" search={{ document: data.documentNumber }} />}
          >
            <ListIcon aria-hidden="true" />
            {t.event.otherEvents}
          </Button>
        )}
      </Section>
      <History actions={data.actions} />
      <Section id="event-raw" title={t.event.raw}>
        <JsonViewer value={data.payload} labels={t.event.json} />
      </Section>
      {manage && data.reason === 'PERIOD_CLOSED' && (
        <ReasonDialog
          open={open === 'move'}
          onOpenChange={(next) => setOpen(next ? 'move' : null)}
          title={t.move.title}
          description={t.move.description}
          reasonLabel={t.resolve.reason}
          submitLabel={t.move.confirm}
          onConfirm={(reason) => action('post-in-open-period', { reason })}
        >
          {data.moveOn && (
            <p className="flex flex-wrap gap-2">
              <span className="text-muted-foreground">{t.move.targetDate}</span>
              <span className="font-medium">{formatDay(data.moveOn)}</span>
            </p>
          )}
        </ReasonDialog>
      )}
      {manage && recognisable && (
        <ReasonDialog
          open={open === 'recognise'}
          onOpenChange={(next) => setOpen(next ? 'recognise' : null)}
          title={ar.revenue.actions.recognise.title}
          description={ar.revenue.actions.recognise.description}
          reasonLabel={t.resolve.reason}
          submitLabel={ar.revenue.actions.recognise.confirm}
          onConfirm={(reason) => action('recognise-in-open-period', { reason })}
        >
          <ActionPreviewPanel
            id={id}
            query={{ action: 'recognise-in-open-period' }}
            enabled={open === 'recognise'}
          />
        </ReasonDialog>
      )}
      {manage && splittable && (
        <SplitDialog
          id={id}
          open={open === 'split'}
          onOpenChange={(next) => setOpen(next ? 'split' : null)}
          onConfirm={(body) => action('split-remainder', body)}
        />
      )}
      {manage && data.reason === 'NEEDS_DECISION' && (
        <ResolveDialog
          open={open === 'resolve'}
          onOpenChange={(next) => setOpen(next ? 'resolve' : null)}
          onConfirm={(body) => action('resolve', body)}
          startMonth={startMonth}
        />
      )}
      {dismiss && (
        <ReasonDialog
          open={open === 'dismiss'}
          onOpenChange={(next) => setOpen(next ? 'dismiss' : null)}
          title={t.dismiss.title}
          description={t.dismiss.description}
          reasonLabel={t.resolve.reason}
          submitLabel={t.dismiss.confirm}
          destructive
          onConfirm={(reason) => action('dismiss', { reason })}
        />
      )}
    </>
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

/** The hold: its reason, its detail, what fixes it, and the event it waits behind. */
function Hold({ event }: { event: InboxEventDetail }) {
  const deferred = event.detail === 'deferred_revenue';
  const fix =
    event.reason && event.reason in t.fixes ? t.fixes[event.reason as keyof typeof t.fixes] : null;
  const links: ReactNode[] = [];
  if (event.reason === 'RATE_MISSING') {
    links.push(
      <Button
        key="rates"
        variant="outline"
        size="sm"
        render={<Link to="/rates" search={{ record: 'bulletin' }} />}
      >
        {t.fixLinks.rates}
      </Button>,
    );
  }
  if (event.detail?.startsWith('account_blocked:')) {
    links.push(
      <Button key="chart" variant="outline" size="sm" render={<Link to="/chart" />}>
        {t.fixLinks.chart}
      </Button>,
    );
  }
  if (event.waitingForId) {
    links.push(
      <Button
        key="waiting"
        variant="outline"
        size="sm"
        render={<Link to="/inbox/$id" params={{ id: event.waitingForId }} />}
      >
        {t.fixLinks.waitingFor}
      </Button>,
    );
  }
  return (
    <Callout
      tone="warning"
      icon={<CirclePauseIcon />}
      title={
        <>
          {`${t.event.hold}: `}
          {reasonLabel(event.reason)}
        </>
      }
      description={
        <span className="flex flex-col gap-1">
          {event.detail && <span className="font-medium">{detailText(event.detail)}</span>}
          <span>{deferred ? t.deferredFix : fix}</span>
        </span>
      }
      action={links.length > 0 ? links : undefined}
    />
  );
}

function History({ actions }: { actions: readonly InboxAction[] }) {
  return (
    <Section id="event-history" title={t.event.history}>
      {actions.length === 0 ? (
        <p className="text-muted-foreground">{t.event.historyEmpty}</p>
      ) : (
        <Table aria-labelledby="event-history">
          <TableHeader>
            <TableRow>
              <TableHead>{t.history.at}</TableHead>
              <TableHead>{t.history.action}</TableHead>
              <TableHead className="max-sm:hidden">{t.history.actor}</TableHead>
              <TableHead>{t.history.reason}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {actions.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap">{formatDateTime(row.createdAt)}</TableCell>
                <TableCell>
                  <span className="flex flex-col gap-0.5">
                    {actionLabel(row.action)}
                    {row.entryIds.length > 0 && (
                      <span className="text-muted-foreground text-xs">
                        {`${t.history.entries}: `}
                        <bdi dir="ltr">{row.entryIds.length}</bdi>
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="max-sm:hidden">
                  <bdi>{row.actor.name}</bdi>
                </TableCell>
                <TableCell>
                  <span className="flex flex-col gap-0.5">
                    {row.reason && <span>{reasonLabel(row.reason)}</span>}
                    {row.detail && (
                      <span className="text-muted-foreground text-xs">
                        {detailText(row.detail)}
                      </span>
                    )}
                    {row.note && <bdi>{row.note}</bdi>}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

/** Resolve by a posted manual entry (rule 15): the entry from the journal and a reason. */
function ResolveDialog({
  open,
  onOpenChange,
  onConfirm,
  startMonth,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (body: { entryId: string; reason: string }) => Promise<unknown>;
  startMonth: number;
}) {
  const { companyId } = useCompany();
  const [query, setQuery] = useState('');
  const [entryId, setEntryId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ entry?: string; reason?: string }>({});
  const [attempt, setAttempt] = useState(0);
  // A number ("2026/14" or "14") finds the entry by its number, other text by its description.
  const byNumber = query ? parseEntryNumber(query) : null;
  const found = useInfiniteQuery({
    ...entriesQuery(companyId, {
      source: 'manual',
      ...(byNumber ?? (query ? { text: query } : {})),
    }),
    enabled: open,
  });
  const [chosen, setChosen] = useState<EntryPickerOption | null>(null);
  const options: EntryPickerOption[] = [
    ...(chosen ? [chosen] : []),
    ...(found.data?.pages.flatMap((page) => page.entries) ?? [])
      .filter((entry) => entry.id !== chosen?.id)
      .map((entry) => ({
        id: entry.id,
        number: formatEntryNumber(entry, startMonth),
        date: formatDay(entry.entryDate),
        description: entry.description,
        totalMinor: BigInt(entry.bookDebit.amountMinor),
        totalCurrency: entry.bookDebit.currency,
      })),
  ];
  const confirm = useMutation({
    mutationFn: (body: { entryId: string; reason: string }) => onConfirm(body),
    onSuccess: () => close(),
  });

  function close() {
    setQuery('');
    setEntryId(null);
    setChosen(null);
    setReason('');
    setErrors({});
    setAttempt(0);
    confirm.reset();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent closeLabel={ar.common.close}>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const parsed = resolveEventSchema.safeParse({ entryId, reason });
            if (!parsed.success) {
              setErrors({
                ...(entryId ? {} : { entry: t.resolve.entryRequired }),
                ...(reason.trim() ? {} : { reason: t.resolve.reasonRequired }),
              });
              setAttempt((count) => count + 1);
              return;
            }
            setErrors({});
            confirm.mutate(parsed.data);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.resolve.title}</DialogTitle>
            <DialogDescription>{t.resolve.description}</DialogDescription>
          </DialogHeader>
          <FormErrorSummary
            attempt={attempt}
            errors={[
              ['resolve-entry', errors.entry],
              ['resolve-reason', errors.reason],
            ]}
          />
          <EntryPicker
            id="resolve-entry"
            label={t.resolve.entry}
            entries={options}
            value={entryId}
            onValueChange={(next) => {
              setEntryId(next);
              setChosen(options.find((option) => option.id === next) ?? null);
            }}
            onQueryChange={setQuery}
            labels={t.resolve.picker}
            error={errors.entry}
          />
          <Field id="resolve-reason" invalid={errors.reason !== undefined}>
            <FieldLabel>{t.resolve.reason}</FieldLabel>
            <Textarea
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
            <FieldError match={errors.reason !== undefined}>{errors.reason}</FieldError>
          </Field>
          <FormError error={confirm.error} />
          <DialogFooter>
            <Button type="submit" loading={confirm.isPending}>
              {t.resolve.confirm}
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              {t.resolve.cancel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
