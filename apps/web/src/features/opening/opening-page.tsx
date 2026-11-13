import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type Account,
  type AmountTextError,
  type DimensionValue,
  type OpeningViewAnswer,
  openingEntryResultSchema,
  openingViewSchema,
  reverseOpeningSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  Badge,
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  type GridProblem,
  PageHeader,
  Skeleton,
  StepList,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import {
  CircleCheckIcon,
  FlagIcon,
  HistoryIcon,
  InfoIcon,
  RefreshCwIcon,
  SettingsIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { ReasonDialog } from '../../components/reason-dialog';
import { useSensitiveAction } from '../../components/reauth-dialog';
import { api, hasCode } from '../../lib/api';
import { formatDateTime, formatEntryNumber } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { accountsQuery } from '../chart/chart-queries';
import { companyQuery } from '../company/company-queries';
import { useFiscalYearStartMonth } from '../entries/entry-parts';
import { useDimensionCatalog } from '../entries/entry-queries';
import { ReportExport } from '../reports/report-parts';
import { AgreementStep, type FigureEdit, figuresInput, figuresOf } from './agreement-step';
import { fill, stepStatuses } from './opening-parts';
import { openingQuery } from './opening-queries';
import {
  isBlankRecord,
  isCompleteRecord,
  type LedgerCurrencies,
  type RecordRow,
  RecordsStep,
  recordLinesInput,
  recordRowsOf,
} from './records-step';
import { ReviewStep } from './review-step';

const t = ar.opening;

/**
 * `/opening` (S10 "Screens"): the company's opening in four steps on one page — Hub's snapshot,
 * the old records' lines, the agreement with Hub per client and currency, and the review with the
 * checks and the entry it would post. The owner and the accountant save the draft; the owner posts
 * it with a fresh code and, while it is the only entry, reverses it with a reason. Posted, it is
 * read only; a stale read (`OPENING_CHANGED`) is read again under a notice.
 */
export function OpeningPage() {
  const { companyId } = useCompany();
  const opening = useQuery(openingQuery(companyId));
  const company = useQuery(companyQuery(companyId));
  const accounts = useQuery(accountsQuery(companyId));
  const catalog = useDimensionCatalog(companyId);
  // Kept above the draft's working copy, which a new view starts over.
  const [notice, setNotice] = useState<Notice>(null);

  const header = <PageHeader title={t.title} description={t.description} />;
  if (opening.isError && hasCode(opening.error, 'NO_BOOKS_START')) {
    return (
      <>
        {header}
        <Callout
          tone="info"
          icon={<SettingsIcon />}
          title={t.noBooksStart.title}
          description={t.noBooksStart.description}
          action={
            <Button variant="outline" size="sm" render={<Link to="/settings/company" />}>
              {t.noBooksStart.action}
            </Button>
          }
        />
      </>
    );
  }
  const error = opening.error ?? company.error ?? accounts.error ?? catalog.error;
  if (error) {
    return (
      <>
        {header}
        <FormError error={error} />
      </>
    );
  }
  if (!opening.data || !company.data || !accounts.data || catalog.isPending) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-20" />
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      </>
    );
  }
  const ledgers: LedgerCurrencies = {
    book: company.data.ledgers.book.currency,
    parallel: company.data.ledgers.parallel?.currency ?? null,
  };
  return (
    <>
      {header}
      {/* A new view (a save, a read again) starts the draft's working copy over. */}
      <Opening
        key={`${opening.data.version}:${opening.data.state ?? 'none'}:${opening.dataUpdatedAt}`}
        view={opening.data}
        accounts={accounts.data}
        catalog={catalog}
        ledgers={ledgers}
        notice={notice}
        onNotice={setNotice}
      />
    </>
  );
}

type Catalog = ReturnType<typeof useDimensionCatalog>;
type Notice = 'saved' | 'changed' | null;

function Opening({
  view,
  accounts,
  catalog,
  ledgers,
  notice,
  onNotice: setNotice,
}: {
  view: OpeningViewAnswer;
  accounts: readonly Account[];
  catalog: Catalog;
  ledgers: LedgerCurrencies;
  notice: Notice;
  onNotice: (notice: Notice) => void;
}) {
  const { companyId, me } = useCompany();
  const queryClient = useQueryClient();
  const { run, dialog } = useSensitiveAction();
  const posted = view.state === 'posted';
  const editable = can(me, 'opening.prepare') && !posted;
  const [rows, setRows] = useState<readonly RecordRow[]>(() => recordRowsOf(view));
  const [figures, setFigures] = useState<readonly FigureEdit[]>(() => figuresOf(view));
  const [gridRefusal, setGridRefusal] = useState<GridProblem | null>(null);
  const [amountErrors, setAmountErrors] = useState<ReadonlySet<string>>(new Set());
  const [linesError, setLinesError] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const [posting, setPosting] = useState(false);
  const [reversing, setReversing] = useState(false);

  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const input = {
    lines: recordLinesInput(rows, accountsById, ledgers),
    recordFigures: figuresInput(figures),
  };
  const savedRows = recordRowsOf(view);
  const savedInput = {
    lines: recordLinesInput(savedRows, accountsById, ledgers),
    recordFigures: figuresInput(figuresOf(view)),
  };
  const typedRows = rows.filter((row) => !isBlankRecord(row));
  const dirty =
    JSON.stringify(input) !== JSON.stringify(savedInput) || typedRows.length !== input.lines.length;
  const holdsRefusedText = gridRefusal !== null || amountErrors.size > 0;

  // The saved preview's records lines, in order, are the saved rows' (rule 23).
  const recordsPreview = view.lines.filter((line) => line.source === 'records');
  const computedOf = new Map(
    dirty
      ? []
      : rows.flatMap((row, index) => {
          const line = recordsPreview[index];
          return line ? [[row.key, line] as const] : [];
        }),
  );

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['opening', companyId] });
    await queryClient.invalidateQueries({ queryKey: ['company', companyId] });
    await queryClient.invalidateQueries({ queryKey: ['entries', companyId] });
  };

  const save = useMutation({
    mutationFn: () =>
      api('PUT', '/opening', {
        company: companyId,
        body: { version: view.version, ...input },
        schema: openingViewSchema,
      }),
    onSuccess: (answer) => {
      setNotice('saved');
      queryClient.setQueryData(openingQuery(companyId).queryKey, answer);
    },
    onError: async (failure) => {
      if (hasCode(failure, 'OPENING_CHANGED')) {
        setNotice('changed');
        await queryClient.invalidateQueries({ queryKey: ['opening', companyId] });
      }
    },
  });

  function submitSave() {
    const incomplete = typedRows.some((row) => !isCompleteRecord(row));
    const problem = holdsRefusedText
      ? t.actions.fixBeforeSaving
      : incomplete
        ? ar.drafts.editor.validation.lines
        : undefined;
    setLinesError(problem);
    if (problem) {
      setAttempt((count) => count + 1);
      return;
    }
    save.mutate();
  }

  const allPass = view.checks.every((check) => check.passed);
  const canPost = can(me, 'opening.post');
  const postReady = canPost && view.state === 'draft' && allPass && !dirty;
  const failing = view.checks.filter((check) => !check.passed);
  const statuses = stepStatuses(view, dirty);
  const step = (id: keyof typeof statuses, label: string) => ({
    id,
    label,
    status: statuses[id],
    statusLabel: t.steps.status[statuses[id]],
    href: `#${id}`,
  });

  return (
    <>
      <Facts view={view} dirty={dirty && editable} />
      {notice === 'saved' && !dirty && (
        <Callout role="status" tone="info" icon={<CircleCheckIcon />} title={t.actions.saved} />
      )}
      {notice === 'changed' && (
        <Callout role="alert" tone="warning" icon={<RefreshCwIcon />} title={t.actions.changed} />
      )}
      {view.posted && <PostedNotice view={view} />}
      {view.reversed && <ReversedNotice view={view} />}
      {!posted && <Callout tone="info" icon={<InfoIcon />} title={t.replayNote} />}
      {!editable && !posted && (
        <Callout tone="info" icon={<InfoIcon />} title={t.records.readOnly} />
      )}

      <StepList
        label={t.steps.label}
        steps={[
          step('hub', t.steps.hub),
          step('records', t.steps.records),
          step('agreement', t.steps.agreement),
          step('review', t.steps.review),
        ]}
      />

      <StepCard id="hub" number={1} title={t.steps.hub}>
        <HubStep view={view} />
      </StepCard>

      <StepCard
        id="records"
        number={2}
        title={t.steps.records}
        description={`${t.records.description} ${t.records.yearResult}`}
      >
        <FormErrorSummary attempt={attempt} errors={[['opening-records', linesError]]} />
        <div id="opening-records" className="flex min-w-0 flex-col gap-3">
          {linesError && (
            <p className="text-destructive-text" role="alert">
              {linesError}
            </p>
          )}
          <RecordsStep
            rows={rows}
            onRowsChange={(change) => {
              setNotice(null);
              setRows((current) => change(current));
            }}
            editable={editable}
            accounts={accounts}
            types={catalog.types}
            values={catalog.byId}
            valuesOf={catalog.valuesOf}
            ledgers={ledgers}
            computed={(row) => computedOf.get(row.key)}
            onEditError={setGridRefusal}
          />
        </div>
      </StepCard>

      <StepCard
        id="agreement"
        number={3}
        title={t.steps.agreement}
        description={t.agreement.description}
        actions={<ReportExport excelPath="/opening/export?part=agreement" />}
      >
        <AgreementStep
          view={view}
          figures={figures}
          onFiguresChange={(next) => {
            setNotice(null);
            setFigures(next);
          }}
          editable={editable}
          clients={clientValues(catalog)}
          values={catalog.byId}
          onTextError={(key, refused: AmountTextError | null) =>
            setAmountErrors((current) => {
              const next = new Set(current);
              if (refused) next.add(key);
              else next.delete(key);
              return next;
            })
          }
        />
      </StepCard>

      <StepCard
        id="review"
        number={4}
        title={t.steps.review}
        description={t.review.description}
        actions={<ReportExport excelPath="/opening/export?part=preview" />}
      >
        <ReviewStep view={view} accounts={accountsById} values={catalog.byId} ledgers={ledgers} />
      </StepCard>

      {!posted && (editable || canPost) && (
        <div
          data-slot="opening-actions"
          className="sticky bottom-0 flex flex-col gap-2 border-t border-border bg-background py-3"
        >
          <FormError error={save.error} />
          {dirty && editable && <p className="text-control">{t.actions.unsaved}</p>}
          {canPost && !allPass && (
            <p id="opening-post-reasons" className="text-control text-muted-foreground">
              {t.actions.postDisabled}{' '}
              {failing.map((check) => t.review.checkNames[check.check]).join('، ')}
            </p>
          )}
          {!canPost && editable && (
            <p className="text-control text-muted-foreground">{t.actions.postOwnerOnly}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {editable && (
              <Button
                variant={dirty ? 'primary' : 'outline'}
                loading={save.isPending}
                onClick={submitSave}
              >
                {t.actions.save}
              </Button>
            )}
            {canPost && (
              <Button
                disabled={!postReady}
                aria-describedby={allPass ? undefined : 'opening-post-reasons'}
                onClick={() => setPosting(true)}
              >
                <FlagIcon aria-hidden="true" />
                {t.actions.post}
              </Button>
            )}
          </div>
        </div>
      )}
      {posted && canPost && (
        <Button variant="destructive" className="w-fit" onClick={() => setReversing(true)}>
          {t.actions.reverse}
        </Button>
      )}

      <ConfirmDialog
        open={posting}
        onOpenChange={setPosting}
        title={t.postDialog.title}
        description={t.postDialog.description}
        submitLabel={t.postDialog.submit}
        onConfirm={async () => {
          try {
            await run(() =>
              api('POST', '/opening/post', {
                company: companyId,
                body: { fingerprint: view.fingerprint },
                schema: openingEntryResultSchema,
              }),
            );
          } catch (failure) {
            if (!hasCode(failure, 'OPENING_CHANGED')) throw failure;
            setNotice('changed');
            await queryClient.invalidateQueries({ queryKey: ['opening', companyId] });
          }
        }}
        onDone={async () => {
          setNotice(null);
          await invalidate();
        }}
      />
      <ReasonDialog
        open={reversing}
        onOpenChange={setReversing}
        title={t.reverseDialog.title}
        description={t.reverseDialog.description}
        reasonLabel={t.reverseDialog.reason}
        submitLabel={t.reverseDialog.submit}
        destructive
        schema={reverseOpeningSchema}
        onConfirm={(reason) =>
          api('POST', '/opening/reverse', {
            company: companyId,
            body: { reason },
            schema: openingEntryResultSchema,
          })
        }
        onDone={invalidate}
      />
      {dialog}
    </>
  );
}

/** The client dimension's values, for a client the records hold and Hub does not. */
function clientValues(catalog: Catalog): readonly DimensionValue[] {
  const client = catalog.types.find((type) => type.code === 'client');
  return client ? catalog.valuesOf(client.id) : [];
}

/** A step's card, its number in its heading, reached by its id from the step list. */
function StepCard({
  id,
  number,
  title,
  description,
  actions,
  children,
}: {
  id: string;
  number: number;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card id={id} className="min-w-0 scroll-mt-4" aria-labelledby={`${id}-title`}>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle id={`${id}-title`}>
            <bdi dir="ltr">{number}</bdi>
            {'. '}
            {title}
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions}
      </CardHeader>
      <div className="flex min-w-0 flex-col gap-4 px-6 pb-6">{children}</div>
    </Card>
  );
}

/** The opening's state, its books start and eve, and the draft's version. */
function Facts({ view, dirty }: { view: OpeningViewAnswer; dirty: boolean }) {
  const f = t.facts;
  return (
    <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-control">
      <div className="flex items-center gap-2">
        <dt className="text-muted-foreground">{f.state}</dt>
        <dd>
          <Badge
            tone={view.state === 'posted' ? 'success' : view.state === null ? 'neutral' : 'info'}
          >
            {view.state === null ? t.notStarted : t.states[view.state]}
          </Badge>
        </dd>
      </div>
      <div className="flex items-center gap-2">
        <dt className="text-muted-foreground">{f.booksStart}</dt>
        <dd>
          <bdi dir="ltr">{view.booksStart}</bdi>
        </dd>
      </div>
      <div className="flex items-center gap-2">
        <dt className="text-muted-foreground">{f.asOf}</dt>
        <dd>
          <bdi dir="ltr">{view.asOf}</bdi>
        </dd>
      </div>
      <div className="flex items-center gap-2">
        <dt className="text-muted-foreground">{f.version}</dt>
        <dd>
          <bdi dir="ltr">{view.version}</bdi>
        </dd>
      </div>
      {dirty && (
        <div>
          <dt className="sr-only">{f.state}</dt>
          <dd>
            <Badge tone="warning">{t.actions.unsaved}</Badge>
          </dd>
        </div>
      )}
    </dl>
  );
}

/** Step 1 (S10 rules 5–9): the latest snapshot's date, counts and totals, or none yet. */
function HubStep({ view }: { view: OpeningViewAnswer }) {
  const h = t.hub;
  if (!view.hubClient && view.snapshot === null) {
    return <p className="text-muted-foreground">{h.noHubClient}</p>;
  }
  if (view.snapshot === null) {
    return (
      <Callout
        tone="warning"
        icon={<TriangleAlertIcon />}
        title={h.noSnapshot}
        description={h.noSnapshotDescription}
      />
    );
  }
  const { result, receivedAt } = view.snapshot;
  const counts = [
    [h.counts.invoices, result.counts.invoices],
    [h.counts.credits, result.counts.credits],
    [h.counts.milestones, result.counts.milestones],
    [h.counts.wallets, result.counts.wallets],
    [h.counts.priorDocuments, result.counts.prior_documents],
  ] as const;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-control">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">
            {view.state === 'posted' ? h.usedSnapshot : h.receivedAt}
          </dt>
          <dd>{formatDateTime(receivedAt)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{h.asOf}</dt>
          <dd>
            <bdi dir="ltr">{result.as_of}</bdi>
          </dd>
        </div>
      </dl>
      <dl
        aria-label={h.counts.label}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        data-slot="opening-snapshot-counts"
      >
        {counts.map(([label, count]) => (
          <div key={label} className="flex flex-col gap-0.5 rounded-lg border border-border p-3">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="text-lg font-semibold">
              <bdi dir="ltr">{count}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      {result.totals.length === 0 ? (
        <p className="text-muted-foreground">{h.totals.none}</p>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">{h.totals.label}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{h.totals.list}</TableHead>
                <TableHead>{h.totals.currency}</TableHead>
                <TableHead numeric>{h.totals.amount}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.totals.map((total) => (
                <TableRow key={`${total.list}:${total.currency}`}>
                  <TableCell>{h.totals.lists[total.list]}</TableCell>
                  <TableCell>
                    <bdi dir="ltr">{total.currency}</bdi>
                  </TableCell>
                  <TableCell numeric>
                    <Amount value={BigInt(total.amount)} currency={total.currency} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function useEntryText() {
  const { companyId } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  return (entry: { fiscalYear: number; number: number }) => formatEntryNumber(entry, startMonth);
}

/** Posted (rule 23): the entry, its date and when it posted, with its link. */
function PostedNotice({ view }: { view: OpeningViewAnswer }) {
  const entryText = useEntryText();
  const posted = view.posted;
  if (!posted) return null;
  return (
    <Callout
      tone="info"
      icon={<CircleCheckIcon />}
      title={t.posted.title}
      description={fill(t.posted.description, {
        number: entryText(posted.entry),
        date: posted.entry.date,
        at: formatDateTime(posted.at),
      })}
      action={
        <Button
          variant="outline"
          size="sm"
          render={<Link to="/entries/$id" params={{ id: posted.entry.id }} />}
        >
          {t.posted.entry}
        </Button>
      }
    />
  );
}

/** The latest reversed opening (rule 25): its entry, its reversal and the reason. */
function ReversedNotice({ view }: { view: OpeningViewAnswer }) {
  const entryText = useEntryText();
  const reversed = view.reversed;
  if (!reversed) return null;
  return (
    <Callout
      tone="neutral"
      icon={<HistoryIcon />}
      title={t.reversed.title}
      description={`${fill(t.reversed.description, {
        number: entryText(reversed.entry),
        reversal: entryText(reversed.reversalEntry),
        at: formatDateTime(reversed.at),
        reason: reversed.reason,
      })}${view.state === 'draft' || view.state === null ? ` ${t.reversed.newDraft}` : ''}`}
    />
  );
}
