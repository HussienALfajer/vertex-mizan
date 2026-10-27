import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  type AuditEntry,
  auditPageSchema,
  COMPANY_AUDIT_ACTIONS,
  type CompanyAuditAction,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Button,
  Card,
  ChangeList,
  type DateRange,
  DateRangeField,
  EmptyState,
  isDateRangeOrdered,
  PageHeader,
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
} from '@vertex-mizan/ui';
import { type ReactNode, useState } from 'react';
import { FormError } from '../../components/form-error';
import { SelectField } from '../../components/form-fields';
import { api } from '../../lib/api';
import { damascusDayBounds, formatDateTime } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { membersQuery } from '../members/members-queries';
import { AuditValue, auditEntityLabel, auditFieldLabel } from './audit-values';

const t = ar.audit;

interface Filters {
  range: DateRange;
  actorUserId: string;
  action: CompanyAuditAction | '';
  entityType: string;
}

const noFilters: Filters = {
  range: { from: '', to: '' },
  actorUserId: '',
  action: '',
  entityType: '',
};

/** The query string of `GET /api/audit` (`auditQuerySchema`); days are Damascus days. */
function auditPath(filters: Filters, cursor: string | undefined): string {
  const params = new URLSearchParams();
  if (filters.range.from) params.set('from', damascusDayBounds(filters.range.from).start);
  if (filters.range.to) params.set('to', damascusDayBounds(filters.range.to).end);
  if (filters.actorUserId) params.set('actorUserId', filters.actorUserId);
  if (filters.action) params.set('action', filters.action);
  if (filters.entityType) params.set('entityType', filters.entityType);
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  return query ? `/audit?${query}` : '/audit';
}

const anyOption = { value: '' as const, label: t.filters.any };
const actionOptions: { value: CompanyAuditAction | ''; label: string }[] = [
  anyOption,
  ...COMPANY_AUDIT_ACTIONS.map((action) => ({ value: action, label: t.actions[action] })),
];
const entityOptions = [
  anyOption,
  ...Object.entries(t.entities).map(([value, label]) => ({ value, label })),
];

/**
 * `/settings/audit` (S01 rules 23–26): the company's audit log, newest first, 100 entries a page,
 * filtered by days, person, action and entity; an entry opens with its changes field by field.
 */
export function AuditPage() {
  const { companyId } = useCompany();
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const members = useQuery(membersQuery(companyId));
  const ordered = isDateRangeOrdered(filters.range);
  const entries = useInfiniteQuery({
    queryKey: ['audit', companyId, filters],
    queryFn: ({ pageParam }) =>
      api('GET', auditPath(filters, pageParam), { schema: auditPageSchema }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: ordered,
  });
  const rows = entries.data?.pages.flatMap((page) => page.entries) ?? [];
  const personOptions = [
    anyOption,
    ...(members.data ?? []).map((member) => ({ value: member.userId, label: member.name })),
  ];
  const set = (change: Partial<Filters>) => setFilters({ ...filters, ...change });
  const filtered = JSON.stringify(filters) !== JSON.stringify(noFilters);

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      <Card className="p-4">
        <search aria-label={t.filters.label} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DateRangeField
            value={filters.range}
            onValueChange={(range) => set({ range })}
            label={t.filters.period}
            fromLabel={t.filters.from}
            toLabel={t.filters.to}
            orderError={t.filters.order}
            className="md:col-span-2"
          />
          <SelectField
            label={t.filters.person}
            value={filters.actorUserId}
            options={personOptions}
            onValueChange={(actorUserId) => set({ actorUserId })}
          />
          <SelectField
            label={t.filters.action}
            value={filters.action}
            options={actionOptions}
            onValueChange={(action) => set({ action })}
          />
          <SelectField
            label={t.filters.entity}
            value={filters.entityType}
            options={entityOptions}
            onValueChange={(entityType) => set({ entityType })}
          />
          {filtered && (
            <Button
              variant="ghost"
              className="w-fit self-end"
              onClick={() => setFilters(noFilters)}
            >
              {t.filters.clear}
            </Button>
          )}
        </search>
      </Card>
      {!ordered ? null : entries.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
        </div>
      ) : entries.isError ? (
        <FormError error={entries.error} />
      ) : rows.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        <>
          <Card className="min-w-0 overflow-hidden">
            <Table aria-label={t.table.label}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.table.time}</TableHead>
                  <TableHead>{t.table.person}</TableHead>
                  <TableHead>{t.table.action}</TableHead>
                  <TableHead>{t.table.entity}</TableHead>
                  <TableHead>{t.table.reason}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t.table.details}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell>
                      <bdi>{entry.actorName}</bdi>
                    </TableCell>
                    <TableCell>{t.actions[entry.action]}</TableCell>
                    <TableCell>{auditEntityLabel(entry.entityType)}</TableCell>
                    <TableCell className="max-w-48 truncate" title={entry.reason ?? undefined}>
                      {entry.reason ? <bdi>{entry.reason}</bdi> : t.detail.none}
                    </TableCell>
                    <TableCell className="text-end">
                      <Button variant="outline" size="sm" onClick={() => setOpen(entry)}>
                        {t.table.details}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          {entries.hasNextPage && (
            <Button
              variant="outline"
              className="w-fit self-center"
              loading={entries.isFetchingNextPage}
              onClick={() => void entries.fetchNextPage()}
            >
              {t.more}
            </Button>
          )}
        </>
      )}
      <EntrySheet entry={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** One entry: who, when, from where, and each changed field before and after (rule 25). */
function EntrySheet({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  const { companyId } = useCompany();
  const members = useQuery(membersQuery(companyId));
  const names = new Map((members.data ?? []).map((member) => [member.userId, member.name]));
  const fields = entry
    ? [...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})])]
    : [];
  const value = (field: string, values: Record<string, unknown> | null) => (
    <AuditValue field={field} value={values?.[field] ?? null} names={names} />
  );
  return (
    <Sheet
      open={entry !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent className="w-full gap-4 overflow-y-auto p-6 sm:max-w-md">
        {entry && (
          <>
            <SheetTitle>{t.actions[entry.action]}</SheetTitle>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-control">
              <Detail label={t.table.time}>{formatDateTime(entry.createdAt)}</Detail>
              <Detail label={t.table.person}>
                <bdi>{entry.actorName}</bdi> ({t.actorKinds[entry.actorKind]})
              </Detail>
              <Detail label={t.table.entity}>{auditEntityLabel(entry.entityType)}</Detail>
              {entry.reason && (
                <Detail label={t.table.reason}>
                  <bdi className="whitespace-pre-line">{entry.reason}</bdi>
                </Detail>
              )}
              <Detail label={t.detail.ipAddress}>
                <bdi dir="ltr">{entry.ipAddress ?? t.detail.unknown}</bdi>
              </Detail>
              <Detail label={t.detail.device}>
                <bdi dir="ltr" className="break-all">
                  {entry.userAgent ?? t.detail.unknown}
                </bdi>
              </Detail>
              <Detail label={t.detail.requestId}>
                <bdi dir="ltr" className="break-all">
                  {entry.requestId}
                </bdi>
              </Detail>
            </dl>
            <h3 className="font-bold text-foreground">{t.detail.changes}</h3>
            <ChangeList
              aria-label={t.detail.changes}
              beforeLabel={t.detail.before}
              afterLabel={t.detail.after}
              changes={fields.map((field) => ({
                id: field,
                label: auditFieldLabel(field),
                before: value(field, entry.before),
                after: value(field, entry.after),
              }))}
              empty={<p className="text-control text-muted-foreground">{t.detail.noChanges}</p>}
            />
            <SheetClose render={<Button variant="secondary" className="w-fit" />}>
              {ar.common.close}
            </SheetClose>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
