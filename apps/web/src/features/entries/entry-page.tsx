import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import {
  draftSchema,
  type Entry,
  reversalResultSchema,
  reverseEntrySchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Button,
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
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
} from '@vertex-mizan/ui';
import { CopyPlusIcon, FileQuestionIcon, Undo2Icon } from 'lucide-react';
import { useState } from 'react';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { api, hasCode } from '../../lib/api';
import { formatDateTime, formatDay, formatEntryNumber } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { companyQuery } from '../company/company-queries';
import {
  AttachmentsCard,
  BackLink,
  EntryLinesTable,
  EntryNumberText,
  Fact,
  useFiscalYearStartMonth,
} from './entry-parts';
import { entryQuery, useDimensionCatalog } from './entry-queries';

const t = ar.entries;
const route = getRouteApi('/_app/_company/entries/$id');

/**
 * `/entries/:id` (S03 "Screens"): the posted entry with its lines in both ledgers, conversions,
 * attachments, reversal links and hash. Reverse, copy and attach per access.
 */
export function EntryPage() {
  const { id } = route.useParams();
  const { companyId } = useCompany();
  const entry = useQuery(entryQuery(companyId, id));
  return entry.isPending ? (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-16" />
      <Skeleton className="h-64" />
    </div>
  ) : entry.isError ? (
    hasCode(entry.error, 'NOT_FOUND') || hasCode(entry.error, 'VALIDATION_FAILED') ? (
      <>
        <BackLink to="/entries" label={t.entry.back} />
        <EmptyState icon={<FileQuestionIcon />} title={t.entry.notFound} />
      </>
    ) : (
      <FormError error={entry.error} />
    )
  ) : (
    <EntryView key={entry.data.id} entry={entry.data} />
  );
}

function EntryView({ entry }: { entry: Entry }) {
  const { companyId, me, membership } = useCompany();
  const navigate = useNavigate();
  const startMonth = useFiscalYearStartMonth(companyId);
  const company = useQuery(companyQuery(companyId)).data;
  const dimensions = useDimensionCatalog(companyId);
  const [reversing, setReversing] = useState(false);
  const active = !membership.company.archived;
  const approval = company?.manualEntryApproval ?? false;
  const reversible = entry.source === 'manual' && !entry.reverses && !entry.reversedBy;
  const canReverse = active && reversible && can(me, approval ? 'drafts.manage' : 'entries.post');
  const canCopy = active && entry.source === 'manual' && can(me, 'drafts.manage');
  const copy = useMutation({
    mutationFn: () =>
      api('POST', `/entries/${entry.id}/copy`, { company: companyId, schema: draftSchema }),
    onSuccess: (draft) => navigate({ to: '/drafts/$id', params: { id: draft.id } }),
  });
  const number = formatEntryNumber(entry, startMonth);
  return (
    <>
      <PageHeader
        back={<BackLink to="/entries" label={t.entry.back} />}
        title={
          <span className="flex flex-wrap items-center gap-x-3">
            {t.table.number}
            <EntryNumberText number={entry} startMonth={startMonth} />
          </span>
        }
        description={<bdi>{entry.description}</bdi>}
        actions={
          <div className="flex flex-wrap gap-2">
            {canReverse && (
              <Button variant="outline" onClick={() => setReversing(true)}>
                <Undo2Icon aria-hidden="true" />
                {t.actions.reverse}
              </Button>
            )}
            {canCopy && (
              <Button variant="outline" loading={copy.isPending} onClick={() => copy.mutate()}>
                <CopyPlusIcon aria-hidden="true" />
                {t.actions.copy}
              </Button>
            )}
          </div>
        }
      />
      <FormError error={copy.error} />
      <Card>
        <dl className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t.entry.date}>{formatDay(entry.entryDate)}</Fact>
          <Fact label={t.entry.postedAt}>{formatDateTime(entry.postedAt)}</Fact>
          <Fact label={t.entry.source}>{t.sources[entry.source]}</Fact>
          <Fact label={t.entry.reference}>
            {entry.reference ? <bdi>{entry.reference}</bdi> : '—'}
          </Fact>
          <Fact label={t.entry.preparedBy}>
            {entry.preparedBy ? <bdi>{entry.preparedBy.name}</bdi> : t.entry.system}
          </Fact>
          {entry.approvedBy && (
            <Fact label={t.entry.approvedBy}>
              <bdi>{entry.approvedBy.name}</bdi>
            </Fact>
          )}
          <Fact label={t.entry.postedBy}>
            {entry.postedBy ? <bdi>{entry.postedBy.name}</bdi> : t.entry.system}
          </Fact>
          {entry.reverses && (
            <Fact label={t.entry.reverses}>
              <Link
                to="/entries/$id"
                params={{ id: entry.reverses.id }}
                className="text-primary underline-offset-4 hover:underline"
              >
                <EntryNumberText number={entry.reverses} startMonth={startMonth} />
              </Link>
            </Fact>
          )}
          {entry.reversedBy && (
            <Fact label={t.entry.reversedBy}>
              <Link
                to="/entries/$id"
                params={{ id: entry.reversedBy.id }}
                className="text-primary underline-offset-4 hover:underline"
              >
                <EntryNumberText number={entry.reversedBy} startMonth={startMonth} />
              </Link>
            </Fact>
          )}
        </dl>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t.entry.lines}</CardTitle>
        </CardHeader>
        <div className="min-w-0 px-6 pb-6">
          <EntryLinesTable
            label={`${t.entry.lines} ${number}`}
            lines={entry.lines}
            bookCurrency={entry.bookCurrency}
            parallelCurrency={entry.parallelCurrency}
            dimensions={dimensions.byId}
          />
        </div>
      </Card>
      <AttachmentsCard
        companyId={companyId}
        attachments={entry.attachments}
        uploadPath={
          active && can(me, 'entries.attach') ? `/entries/${entry.id}/attachments` : undefined
        }
        invalidate={entryQuery(companyId, entry.id).queryKey}
      />
      <Card>
        <CardHeader>
          <CardTitle>{t.entry.chain}</CardTitle>
        </CardHeader>
        <dl className="grid gap-4 px-6 pb-6 sm:grid-cols-3">
          <Fact label={t.entry.sequence}>
            <bdi dir="ltr">{entry.sequence}</bdi>
          </Fact>
          <Fact label={t.entry.hash}>
            <Digest value={entry.hash} copyLabel={t.entry.copyHash} copiedLabel={t.entry.copied} />
          </Fact>
          <Fact label={t.entry.previousHash}>
            {entry.previousHash ? (
              <Digest
                value={entry.previousHash}
                copyLabel={t.entry.copyHash}
                copiedLabel={t.entry.copied}
              />
            ) : (
              t.entry.firstInChain
            )}
          </Fact>
        </dl>
      </Card>
      {reversing && (
        <ReverseDialog
          entry={entry}
          number={number}
          approval={approval}
          onClose={() => setReversing(false)}
        />
      )}
    </>
  );
}

/**
 * Reverse a manual entry (S03 rule 9): the date (the original's by default) and the description
 * ("عكس القيد 2026/1: " and the reason). Approval off, the reversal posts; on, its draft opens.
 */
function ReverseDialog({
  entry,
  number,
  approval,
  onClose,
}: {
  entry: Entry;
  number: string;
  approval: boolean;
  onClose: () => void;
}) {
  const { companyId } = useCompany();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(entry.entryDate);
  const [description, setDescription] = useState(`${t.reverse.defaultDescription} ${number}: `);
  const [errors, setErrors] = useState<{
    date?: string | undefined;
    description?: string | undefined;
  }>({});
  const [attempt, setAttempt] = useState(0);
  const reverse = useMutation({
    mutationFn: (body: unknown) =>
      api('POST', `/entries/${entry.id}/reverse`, {
        company: companyId,
        body,
        schema: reversalResultSchema,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['entries', companyId] });
      await queryClient.invalidateQueries({ queryKey: ['drafts', companyId] });
      onClose();
      if (result.entry) await navigate({ to: '/entries/$id', params: { id: result.entry.id } });
      else if (result.draft) await navigate({ to: '/drafts/$id', params: { id: result.draft.id } });
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
            const parsed = reverseEntrySchema.safeParse({ date, description });
            const found = {
              date: date === '' ? ar.drafts.editor.validation.date : undefined,
              description:
                description.trim() === ''
                  ? ar.drafts.editor.validation.statement
                  : description.trim().length > 500
                    ? ar.drafts.editor.validation.statementLength
                    : undefined,
            };
            setErrors(found);
            if (!parsed.success || found.date || found.description) {
              setAttempt((count) => count + 1);
              return;
            }
            reverse.mutate(parsed.data);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.reverse.title}</DialogTitle>
            <DialogDescription>
              {approval ? t.reverse.approvalDescription : t.reverse.description}
            </DialogDescription>
          </DialogHeader>
          <FormErrorSummary
            attempt={attempt}
            errors={[
              ['reverse-date', errors.date],
              ['reverse-description', errors.description],
            ]}
          />
          <Field id="reverse-date" invalid={errors.date !== undefined}>
            <FieldLabel>{t.reverse.date}</FieldLabel>
            <Input
              type="date"
              dir="ltr"
              value={date}
              min={entry.entryDate}
              onChange={(event) => setDate(event.target.value)}
            />
            <FieldDescription>{t.reverse.dateHint}</FieldDescription>
            <FieldError match={errors.date !== undefined}>{errors.date}</FieldError>
          </Field>
          <Field id="reverse-description" invalid={errors.description !== undefined}>
            <FieldLabel>{t.reverse.descriptionLabel}</FieldLabel>
            <Textarea
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
            />
            <FieldError match={errors.description !== undefined}>{errors.description}</FieldError>
          </Field>
          <FormError error={reverse.error} />
          <DialogFooter>
            <Button type="submit" loading={reverse.isPending}>
              {approval ? t.reverse.submitDraft : t.reverse.submit}
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
