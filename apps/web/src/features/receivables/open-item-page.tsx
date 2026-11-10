import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { changeDueDateSchema, type OpenItem, openItemSchema } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  Amount,
  Badge,
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
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  Input,
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
import { CalendarClockIcon, CircleCheckIcon, FileQuestionIcon, InfoIcon } from 'lucide-react';
import { useState } from 'react';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { api, hasCode } from '../../lib/api';
import { damascusToday, formatDateTime, formatDay } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { EntryNumberText, Fact, useFiscalYearStartMonth } from '../entries/entry-parts';
import { HubDocumentLink } from '../inbox/inbox-parts';
import { AdjustedBadge, ClientName, ReceivablesBackLink } from './receivables-parts';
import { openItemQuery } from './receivables-queries';

const t = ar.openItems.item;

const route = getRouteApi('/_app/_company/open-items/$id');

/**
 * `/open-items/:id` (S04 "Screens"): the item's header, its open amount and carrying amounts in
 * both ledgers, every movement with its entry, the due-date history; a manual document item's due
 * date changed with a reason (`open_items.manage`, rule 15). A Hub item says its due date comes
 * from Hub.
 */
export function OpenItemPage() {
  const { id } = route.useParams();
  const { companyId, me, membership } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const item = useQuery(openItemQuery(companyId, id));
  const [changing, setChanging] = useState(false);

  if (hasCode(item.error, 'NOT_FOUND') || hasCode(item.error, 'VALIDATION_FAILED')) {
    return (
      <>
        <ReceivablesBackLink />
        <EmptyState icon={<FileQuestionIcon />} title={t.notFound} />
      </>
    );
  }
  if (item.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-control w-64" />
        <Skeleton className="h-row" />
        <Skeleton className="h-row" />
      </div>
    );
  }
  if (item.isError) return <FormError error={item.error} />;
  const data = item.data;
  const document = data.kind === 'document';
  const manual = data.source === 'manual';
  const canChange =
    document && manual && !membership.company.archived && can(me, 'open_items.manage');
  return (
    <>
      <PageHeader
        back={<ReceivablesBackLink />}
        title={
          <span className="flex flex-wrap items-center gap-x-3">
            {t.title}
            <bdi>{data.reference}</bdi>
          </span>
        }
        description={t.description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={data.state === 'settled' ? 'success' : 'info'}>
              {ar.openItems.states[data.state]}
            </Badge>
            <AdjustedBadge adjusted={data.adjusted} />
            {canChange && (
              <Button variant="outline" onClick={() => setChanging(true)}>
                <CalendarClockIcon aria-hidden="true" />
                {t.changeDueDate}
              </Button>
            )}
          </div>
        }
      />
      {data.state === 'settled' && (
        <Callout role="status" tone="info" icon={<CircleCheckIcon />} title={t.settledNote} />
      )}
      {document && !manual && <Callout tone="info" icon={<InfoIcon />} title={t.hubDueNote} />}
      <Card className="p-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t.account}>
            <AccountLabel code={data.account.code} name={data.account.name} />
          </Fact>
          <Fact label={t.client}>
            {data.client ? (
              <Link
                to="/receivables/clients/$valueId"
                params={{ valueId: data.client.id }}
                className="underline-offset-4 hover:underline"
              >
                <ClientName client={data.client} />
              </Link>
            ) : (
              <ClientName client={null} />
            )}
          </Fact>
          <Fact label={t.currency}>
            <bdi dir="ltr">{data.currency}</bdi>
          </Fact>
          <Fact label={t.kind}>{ar.openItems.kinds[data.kind]}</Fact>
          <Fact label={t.source}>
            {ar.openItems.sources[data.source]}
            {data.hubDocument && (
              <span className="block text-xs text-muted-foreground">
                {`${t.hubDocument}: `}
                <HubDocumentLink document={data.hubDocument} eventId={data.hubEventId} />
              </span>
            )}
          </Fact>
          <Fact label={t.documentDate}>{formatDay(data.documentDate)}</Fact>
          <Fact label={t.dueOn}>{data.dueOn ? formatDay(data.dueOn) : t.noDueDate}</Fact>
        </dl>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t.amounts}</CardTitle>
        </CardHeader>
        <dl className="grid gap-4 px-6 pb-6 sm:grid-cols-3">
          <Fact label={t.open}>
            <Amount
              value={BigInt(data.amounts.openMinor)}
              currency={data.currency}
              showCurrency
              strong
            />
          </Fact>
          <Fact label={t.book}>
            <Amount
              value={BigInt(data.amounts.bookMinor)}
              currency={data.bookCurrency}
              showCurrency
              strong
            />
          </Fact>
          {data.parallelCurrency && data.amounts.parallelMinor !== null && (
            <Fact label={t.parallel}>
              <Amount
                value={BigInt(data.amounts.parallelMinor)}
                currency={data.parallelCurrency}
                showCurrency
                strong
              />
            </Fact>
          )}
        </dl>
      </Card>
      <Movements item={data} startMonth={startMonth} />
      {document && <DueDates item={data} />}
      {canChange && <DueDateDialog item={data} open={changing} onOpenChange={setChanging} />}
    </>
  );
}

function Movements({ item, startMonth }: { item: OpenItem; startMonth: number }) {
  return (
    <section aria-labelledby="item-movements" className="flex min-w-0 flex-col gap-3">
      <h2 id="item-movements" className="text-lg font-bold">
        {t.movementsLabel}
      </h2>
      <Table aria-labelledby="item-movements">
        <TableHeader>
          <TableRow>
            <TableHead>{t.date}</TableHead>
            <TableHead>{t.entry}</TableHead>
            <TableHead>{t.movement}</TableHead>
            <TableHead numeric>{t.amount}</TableHead>
            <TableHead numeric>
              {`${t.book} `}
              <bdi dir="ltr">{item.bookCurrency}</bdi>
            </TableHead>
            {item.parallelCurrency && (
              <TableHead numeric>
                {`${t.parallel} `}
                <bdi dir="ltr">{item.parallelCurrency}</bdi>
              </TableHead>
            )}
            <TableHead numeric>{t.balanceAfter}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {item.movements.map((movement) => (
            <TableRow key={movement.id}>
              <TableCell className="whitespace-nowrap">{formatDay(movement.entryDate)}</TableCell>
              <TableCell>
                <span className="flex flex-col gap-1">
                  <Link
                    to="/entries/$id"
                    params={{ id: movement.entryId }}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    <EntryNumberText number={movement} startMonth={startMonth} />
                  </Link>
                  <bdi className="max-w-64 truncate text-xs text-muted-foreground">
                    {movement.memo ?? movement.description}
                  </bdi>
                </span>
              </TableCell>
              <TableCell>
                <span className="flex flex-col items-start gap-1">
                  <Badge tone="neutral">{ar.openItems.movements[movement.kind]}</Badge>
                  <AdjustedBadge adjusted={movement.adjusted} />
                </span>
              </TableCell>
              <TableCell numeric>
                <Amount value={BigInt(movement.amounts.openMinor)} currency={item.currency} />
              </TableCell>
              <TableCell numeric>
                <Amount value={BigInt(movement.amounts.bookMinor)} currency={item.bookCurrency} />
              </TableCell>
              {item.parallelCurrency && (
                <TableCell numeric>
                  {movement.amounts.parallelMinor !== null && (
                    <Amount
                      value={BigInt(movement.amounts.parallelMinor)}
                      currency={item.parallelCurrency}
                    />
                  )}
                </TableCell>
              )}
              <TableCell numeric>
                <Amount value={BigInt(movement.balance.openMinor)} currency={item.currency} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {item.movements.length === 0 && <EmptyState title={t.noMovements} />}
    </section>
  );
}

function DueDates({ item }: { item: OpenItem }) {
  return (
    <section aria-labelledby="item-due-dates" className="flex min-w-0 flex-col gap-3">
      <h2 id="item-due-dates" className="text-lg font-bold">
        {t.dueDatesLabel}
      </h2>
      <Table aria-labelledby="item-due-dates">
        <TableHeader>
          <TableRow>
            <TableHead>{t.dueOn}</TableHead>
            <TableHead>{t.effectiveOn}</TableHead>
            <TableHead>{t.setBy}</TableHead>
            <TableHead>{t.by}</TableHead>
            <TableHead>{t.reason}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {item.dueDates.map((row) => (
            <TableRow key={`${row.createdAt}-${row.dueOn}`}>
              <TableCell>{formatDay(row.dueOn)}</TableCell>
              <TableCell>{formatDay(row.effectiveOn)}</TableCell>
              <TableCell>{ar.openItems.dueDateSetters[row.setBy]}</TableCell>
              <TableCell>
                {row.by ? <bdi>{row.by.name}</bdi> : null}
                <span className="block text-xs text-muted-foreground">
                  {formatDateTime(row.createdAt)}
                </span>
              </TableCell>
              <TableCell className="max-w-72 whitespace-normal">
                {row.reason && <bdi>{row.reason}</bdi>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

/** Rule 15: a new due date, any date, effective today, with a reason. */
function DueDateDialog({
  item,
  open,
  onOpenChange,
}: {
  item: OpenItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const [dueOn, setDueOn] = useState(item.dueOn ?? '');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ dueOn?: string | undefined; reason?: string | undefined }>(
    {},
  );
  const [attempt, setAttempt] = useState(0);
  // Before its document date an item keeps the due date it opened with (rule 15, owner 2026-11-07).
  const early = damascusToday() < item.documentDate;
  const change = useMutation({
    mutationFn: (body: { dueOn: string; reason: string }) =>
      api('PUT', `/open-items/${item.id}/due-date`, {
        company: companyId,
        body,
        schema: openItemSchema,
      }),
    onSuccess: async (next) => {
      queryClient.setQueryData(openItemQuery(companyId, item.id).queryKey, next);
      await queryClient.invalidateQueries({ queryKey: ['receivables', companyId] });
      close();
    },
  });

  function close() {
    setDueOn(item.dueOn ?? '');
    setReason('');
    setErrors({});
    setAttempt(0);
    change.reset();
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
            const parsed = changeDueDateSchema.safeParse({ dueOn, reason });
            if (!parsed.success) {
              const found = {
                dueOn: dueOn === '' ? ar.openItems.dueDate.required : undefined,
                reason:
                  reason.trim() === ''
                    ? ar.openItems.dueDate.required
                    : reason.trim().length > 1000
                      ? ar.openItems.dueDate.reasonLength
                      : undefined,
              };
              setErrors(found);
              setAttempt((count) => count + 1);
              return;
            }
            setErrors({});
            change.mutate(parsed.data);
          }}
        >
          <DialogHeader>
            <DialogTitle>{ar.openItems.dueDate.title}</DialogTitle>
            <DialogDescription>{ar.openItems.dueDate.description}</DialogDescription>
          </DialogHeader>
          {early && (
            <Callout
              tone="warning"
              icon={<InfoIcon />}
              title={ar.openItems.dueDate.beforeDocument}
            />
          )}
          <FormErrorSummary
            attempt={attempt}
            errors={[
              ['due-on', errors.dueOn],
              ['due-reason', errors.reason],
            ]}
          />
          <Field id="due-on" invalid={errors.dueOn !== undefined}>
            <FieldLabel>{ar.openItems.dueDate.dueOn}</FieldLabel>
            <Input
              type="date"
              dir="ltr"
              value={dueOn}
              onChange={(event) => setDueOn(event.target.value)}
            />
            <FieldError match={errors.dueOn !== undefined}>{errors.dueOn}</FieldError>
          </Field>
          <Field id="due-reason" invalid={errors.reason !== undefined}>
            <FieldLabel>{ar.openItems.dueDate.reason}</FieldLabel>
            <Textarea
              value={reason}
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
            />
            <FieldError match={errors.reason !== undefined}>{errors.reason}</FieldError>
          </Field>
          <FormError error={change.error} />
          <DialogFooter>
            <Button type="submit" loading={change.isPending} disabled={early}>
              {ar.openItems.dueDate.submit}
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              {ar.common.cancel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
