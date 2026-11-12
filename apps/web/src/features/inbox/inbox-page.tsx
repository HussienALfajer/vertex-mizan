import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import {
  EVENT_TYPES,
  type EventType,
  HOLD_REASONS,
  type HoldReason,
  type InboxEvent,
  type InboxQuery,
  inboxEventDetailSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Button,
  Callout,
  Card,
  DateRangeField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldLabel,
  IconButton,
  Input,
  isDateRangeOrdered,
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
import { CircleCheckIcon, CirclePauseIcon, InboxIcon, RotateCwIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { FormError } from '../../components/form-error';
import { api } from '../../lib/api';
import { formatDateTime, formatDay } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { useFiscalYearStartMonth } from '../entries/entry-parts';
import {
  detailText,
  EntryLinks,
  EventLink,
  EventStateText,
  reasonLabel,
  typeLabel,
} from './inbox-parts';
import { inboxListQuery } from './inbox-queries';

const t = ar.inbox;
const route = getRouteApi('/_app/_company/inbox/');

export const INBOX_VIEWS = ['held', 'posted', 'all'] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

interface Filters {
  readonly reason: HoldReason | 'any';
  readonly type: EventType | 'any';
  readonly range: { from: string; to: string };
}

const noFilters: Filters = { reason: 'any', type: 'any', range: { from: '', to: '' } };

const reasonOptions = [
  { value: 'any' as const, label: t.filters.anyReason },
  ...HOLD_REASONS.map((reason) => ({ value: reason, label: t.reasons[reason] })),
];

const typeOptions = [
  { value: 'any' as const, label: t.filters.anyType },
  ...EVENT_TYPES.map((type) => ({ value: type, label: t.types[type] })),
];

/** The query of a view, its filters and a document number from the palette. */
function queryOf(view: InboxView, filters: Filters, document?: string): Omit<InboxQuery, 'cursor'> {
  return {
    ...(view === 'all' ? {} : { state: view }),
    ...(filters.reason !== 'any' && view !== 'posted' ? { reason: filters.reason } : {}),
    ...(filters.type !== 'any' ? { type: filters.type } : {}),
    ...(filters.range.from ? { from: filters.range.from } : {}),
    ...(filters.range.to ? { to: filters.range.to } : {}),
    ...(document ? { document } : {}),
  };
}

/**
 * `/inbox` (S05 "Screens"): Hub's events in three tabs, held (the default), posted and all, with
 * filters by reason, type and accounting dates; `?document=`, from the palette's "حدث…", lists one
 * Hub document's events. A held event is retried from its row (`events.manage`).
 */
export function InboxPage() {
  const search = route.useSearch();
  const view: InboxView = search.document ? 'all' : (search.view ?? 'held');
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>(() => ({
    ...noFilters,
    ...(search.reason ? { reason: search.reason } : {}),
    range: { from: search.from ?? '', to: search.to ?? '' },
  }));
  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      <DocumentFinder
        open={search.find === 'document'}
        onClose={() => void navigate({ to: '/inbox', search: {}, replace: true })}
        onFind={(document) => void navigate({ to: '/inbox', search: { document }, replace: true })}
      />
      {search.document && (
        <Callout
          tone="info"
          icon={<InboxIcon />}
          title={
            <>
              {`${t.entryLink.hubDocument}: `}
              <bdi dir="ltr">{search.document}</bdi>
            </>
          }
          action={
            <Button variant="outline" size="sm" render={<Link to="/inbox" search={{}} />}>
              <XIcon aria-hidden="true" />
              {t.filters.clear}
            </Button>
          }
        />
      )}
      <Tabs
        value={view}
        onValueChange={(next) =>
          void navigate({ to: '/inbox', search: { view: next as InboxView }, replace: true })
        }
      >
        <TabsList aria-label={t.views.label}>
          {INBOX_VIEWS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t.views[value]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={view} className="flex min-w-0 flex-col gap-4">
          <FilterBar view={view} filters={filters} onChange={setFilters} />
          <EventList view={view} filters={filters} document={search.document} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/** The palette's "حدث…": a Hub document's number, then its events. */
function DocumentFinder({
  open,
  onClose,
  onFind,
}: {
  open: boolean;
  onClose: () => void;
  onFind: (document: string) => void;
}) {
  const [text, setText] = useState('');
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={ar.common.close}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const document = text.trim();
            if (document === '') return;
            setText('');
            onFind(document);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.palette.findTitle}</DialogTitle>
            <DialogDescription>{t.palette.findDescription}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel>{t.palette.findLabel}</FieldLabel>
            <Input
              dir="ltr"
              autoFocus
              value={text}
              placeholder={t.palette.findPlaceholder}
              maxLength={100}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="submit">{t.palette.findSubmit}</Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              {ar.common.cancel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FilterBar({
  view,
  filters,
  onChange,
}: {
  view: InboxView;
  filters: Filters;
  onChange: (filters: Filters) => void;
}) {
  const filtered = filters !== noFilters;
  return (
    <Card className="p-4">
      <search aria-label={t.filters.label}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DateRangeField
            value={filters.range}
            onValueChange={(range) => onChange({ ...filters, range })}
            label={t.filters.dates}
            fromLabel={t.filters.from}
            toLabel={t.filters.to}
            orderError={ar.entries.filters.order}
            className="md:col-span-2"
          />
          {view !== 'posted' && (
            <SelectField
              label={t.filters.reason}
              value={filters.reason}
              options={reasonOptions}
              onValueChange={(reason) => onChange({ ...filters, reason })}
            />
          )}
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <SelectField
                label={t.filters.type}
                value={filters.type}
                options={typeOptions}
                onValueChange={(type) => onChange({ ...filters, type })}
              />
            </div>
            {filtered && (
              <Button variant="ghost" onClick={() => onChange(noFilters)}>
                <XIcon aria-hidden="true" />
                {t.filters.clear}
              </Button>
            )}
          </div>
        </div>
      </search>
    </Card>
  );
}

/** What a retry from a row led to, said once above the list. */
type RetryResult = { readonly state: string; readonly reason: string | null } | null;

function EventList({
  view,
  filters,
  document,
}: {
  view: InboxView;
  filters: Filters;
  document?: string | undefined;
}) {
  const { companyId, me, membership } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const queryClient = useQueryClient();
  const ordered = isDateRangeOrdered(filters.range);
  const list = useInfiniteQuery({
    ...inboxListQuery(companyId, queryOf(view, filters, document)),
    enabled: ordered,
  });
  const [result, setResult] = useState<RetryResult>(null);
  const retry = useMutation({
    mutationFn: (id: string) =>
      api('POST', `/inbox/${id}/retry`, { company: companyId, schema: inboxEventDetailSchema }),
    onMutate: () => setResult(null),
    onSuccess: (event) => {
      setResult({ state: event.state, reason: event.reason });
      void queryClient.invalidateQueries({ queryKey: ['inbox', companyId] });
    },
  });
  const canRetry = can(me, 'events.manage') && !membership.company.archived;
  const rows = list.data?.pages.flatMap((page) => page.events) ?? [];
  const filtered = filters !== noFilters || document !== undefined;

  if (!ordered) return null;
  if (list.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-row" />
        <Skeleton className="h-row" />
        <Skeleton className="h-row" />
      </div>
    );
  }
  if (list.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <FormError error={list.error} />
        <Button variant="outline" onClick={() => void list.refetch()}>
          <RotateCwIcon aria-hidden="true" />
          {ar.common.retry}
        </Button>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<InboxIcon />}
        title={
          document
            ? t.palette.findNone
            : filtered
              ? t.empty.filtered
              : view === 'all'
                ? t.empty.none
                : t.empty[view]
        }
      />
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div aria-live="polite">
        {result && (
          <Callout
            role="status"
            tone={result.state === 'held' ? 'warning' : 'info'}
            icon={result.state === 'held' ? <CirclePauseIcon /> : <CircleCheckIcon />}
            title={
              result.state === 'held'
                ? `${t.retried.held}: ${reasonLabel(result.reason) ?? ''}`
                : t.retried.posted
            }
          />
        )}
      </div>
      <FormError error={retry.error} />
      <Table aria-label={`${t.table.label}: ${t.views[view]}`}>
        <TableHeader>
          <TableRow>
            <TableHead>{t.table.type}</TableHead>
            <TableHead>{t.table.document}</TableHead>
            <TableHead className="max-md:hidden">{t.table.client}</TableHead>
            <TableHead className="max-sm:hidden">{t.table.accountingDate}</TableHead>
            <TableHead className="max-xl:hidden">{t.table.receivedAt}</TableHead>
            <TableHead>{t.table.state}</TableHead>
            <TableHead className="max-md:hidden">{t.table.entries}</TableHead>
            {canRetry && <TableHead className="sr-only">{t.table.actions}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              startMonth={startMonth}
              actions={canRetry}
              retry={
                canRetry && event.state === 'held'
                  ? {
                      run: () => retry.mutate(event.id),
                      pending: retry.isPending && retry.variables === event.id,
                    }
                  : null
              }
            />
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
  );
}

function EventRow({
  event,
  startMonth,
  actions,
  retry,
}: {
  event: InboxEvent;
  startMonth: number;
  /** Whether the table has the actions column. */
  actions: boolean;
  retry: { run: () => void; pending: boolean } | null;
}) {
  return (
    <TableRow>
      <TableCell>
        <EventLink id={event.id} type={event.type} />
      </TableCell>
      <TableCell>
        {event.documentNumber ? <bdi dir="ltr">{event.documentNumber}</bdi> : t.table.noClient}
      </TableCell>
      <TableCell className="max-md:hidden">
        {event.clientName ? <bdi>{event.clientName}</bdi> : t.table.noClient}
      </TableCell>
      <TableCell className="max-sm:hidden whitespace-nowrap">
        {formatDay(event.accountingDate)}
      </TableCell>
      <TableCell className="max-xl:hidden whitespace-nowrap">
        {formatDateTime(event.receivedAt)}
      </TableCell>
      <TableCell className="min-w-48 max-w-72 py-1 whitespace-normal">
        <span className="flex flex-col gap-1">
          <EventStateText state={event.state} reason={event.reason} />
          {event.state === 'held' && event.detail && (
            <span className="text-muted-foreground text-xs">{detailText(event.detail)}</span>
          )}
        </span>
      </TableCell>
      <TableCell className="max-md:hidden">
        <EntryLinks
          entries={event.resolvedBy ? [event.resolvedBy] : event.entries}
          startMonth={startMonth}
        />
      </TableCell>
      {actions && (
        <TableCell>
          {retry && (
            <IconButton
              variant="outline"
              loading={retry.pending}
              onClick={retry.run}
              label={`${t.retry}: ${typeLabel(event.type)} ${event.documentNumber ?? ''}`.trim()}
            >
              <RotateCwIcon aria-hidden="true" />
            </IconButton>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}
