import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  type Account,
  type Company,
  CURRENCY_CODES,
  type CurrencyCode,
  type Draft,
  draftSchema,
  type EntryPreview,
  entryPreviewSchema,
  isZeroQuantity,
  money,
  type OpenItemPage,
  type ProjectDocumentKind,
  postedDraftSchema,
  RETENTION_SIDES,
  type RetentionSide,
  summarizeAmounts,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountPicker,
  Amount,
  AmountInput,
  Badge,
  BillingSummary,
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  DateRangeField,
  DimensionPicker,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  Kbd,
  keymap,
  MaterialPicker,
  matchesShortcut,
  PageHeader,
  SelectField,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  VoucherHeader,
} from '@vertex-mizan/ui';
import {
  CheckIcon,
  CircleCheckIcon,
  EyeIcon,
  InfoIcon,
  PlusIcon,
  SaveIcon,
  SendIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
  XIcon,
} from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { ReasonDialog } from '../../components/reason-dialog';
import { api } from '../../lib/api';
import { damascusToday } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import {
  accountPickerLabels,
  BackLink,
  dimensionPickerLabels,
  pickerAccounts,
  pickerValues,
} from '../entries/entry-parts';
import { draftQuery } from '../entries/entry-queries';
import { PreviewPanel } from '../entries/preview-panel';
import { openItemsQuery } from '../receivables/receivables-queries';
import {
  daysOf,
  documentInputOf,
  type EditDocument,
  editDocumentOf,
  emptyPurchaseLine,
  emptyWageLine,
  isBlankPurchaseLine,
  isBlankWageLine,
  newDocument,
  type PurchaseLine,
  purchaseLineAmount,
  quantityOf,
  unitPriceOf,
  type WageLine,
  wageLineAmount,
} from './document-lines';
import { basisPointsText, billingSummaryLabels, useProjectCatalog } from './project-parts';
import { projectTermsQuery, subcontractsQuery, useMaterials } from './project-queries';

const t = ar.projects;
const f = t.form;

const currencyOptions = CURRENCY_CODES.map((code) => ({
  value: code,
  label: `${code} · ${ar.accounting.currencies[code]}`,
}));

/** The cost accounts a purchase line takes: postable expenses (S12 rule 7), not control accounts. */
const costAccounts = (accounts: readonly Account[]) =>
  accounts.filter(
    (account) =>
      account.kind === 'postable' &&
      account.class === 'expense' &&
      !account.isControl &&
      !account.archived,
  );

/** What the form checks before a save, a post or a submit; the API checks it again. */
type Problems = Partial<Record<string, string>>;

class Incomplete extends Error {
  override readonly name = 'Incomplete';
}

/**
 * A project document's form (S12 "Screens", rules 7–21): the header its kind takes (project,
 * supplier, date or period, the cumulative of a billing, the side of a release), then its lines —
 * a purchase's cost lines with `MaterialPicker` and the quantity's amount computed, a wage sheet's
 * row per worker line (days × daily rate, or a lump sum with its description), a billing's
 * `BillingSummary` with editable deductions, a client's release's open retentions — and the
 * draft's actions by its state, the approval switch and the person's access. The preview shows
 * every derived line in both ledgers with its covered part, the document's figures and warnings.
 * `draft` is null for a new document: the first save creates it.
 */
export function ProjectDocumentEditor({
  draft,
  kind,
  company,
  accounts,
  projectId = null,
  runPreview = false,
}: {
  draft: Draft | null;
  kind: ProjectDocumentKind;
  company: Company;
  accounts: readonly Account[];
  /** A new document from a project's page starts on that project. */
  projectId?: string | null;
  runPreview?: boolean;
}) {
  const { companyId, me, membership } = useCompany();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectCatalog = useProjectCatalog(companyId);
  const [edit, setEdit] = useState<EditDocument>(
    () => (draft ? editDocumentOf(draft) : null) ?? newDocument(kind, damascusToday(), projectId),
  );
  const { header } = edit;
  const saved = useRef<{ body: string; draft: Draft | null }>({
    body: draft ? JSON.stringify(documentInputOf(edit)) : '',
    draft,
  });
  const [refused, setRefused] = useState<ReadonlySet<string>>(new Set());
  const [problems, setProblems] = useState<Problems>({});
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<{ answer: EntryPreview; body: string } | null>(null);
  const [notice, setNotice] = useState<'saved' | null>(null);
  const [dialog, setDialog] = useState<'discard' | 'reject' | null>(null);

  const active = !membership.company.archived;
  const state = draft?.state ?? 'draft';
  const manage = active && can(me, 'drafts.manage');
  const editable = manage && state === 'draft' && !draft?.archived;
  const approval = company.manualEntryApproval;
  const body = JSON.stringify(documentInputOf(edit));
  const dirty = body !== saved.current.body;
  const canApprove =
    active && draft !== null && state === 'submitted' && can(me, 'entries.approve');
  const preparerOrSubmitter =
    draft !== null &&
    (draft.preparedBy.id === me.person.id || draft.submitted?.by.id === me.person.id);

  const isBilling = kind === 'progress_billing' || kind === 'subcontract_billing';
  const supplierSide = kind === 'retention_release' && header.side === 'supplier';
  const takesSupplier = kind === 'purchase' || kind === 'subcontract_billing' || supplierSide;
  const project = header.projectId ? projectCatalog.catalog.byId.get(header.projectId) : undefined;
  const clientId = project?.parentValueId ?? null;
  const terms = useQuery({
    ...projectTermsQuery(companyId, header.projectId ?? ''),
    enabled:
      header.projectId !== null && (kind === 'progress_billing' || kind === 'retention_release'),
  });
  const subcontracts = useQuery({
    ...subcontractsQuery(companyId, {
      contract: header.projectId ?? undefined,
      supplier: header.counterpartyId ?? undefined,
    }),
    enabled:
      header.projectId !== null &&
      header.counterpartyId !== null &&
      (kind === 'subcontract_billing' || supplierSide),
  });
  const subcontract = subcontracts.data?.subcontracts.find(
    (candidate) => candidate.archivedAt === null,
  );
  const termsOf = terms.data?.terms ?? null;
  // A purchase and a wage sheet name their currency; the others take their terms' (rules 14, 18).
  const currency: CurrencyCode | null =
    kind === 'purchase' || kind === 'wage_sheet'
      ? header.currency
      : kind === 'subcontract_billing' || supplierSide
        ? (subcontract?.currency ?? null)
        : (termsOf?.currency ?? null);
  const materialsRead = useMaterials(companyId, kind === 'purchase');
  const retentionAccount = accounts.find((account) => account.code === '113002');
  const retentions = useQuery({
    ...openItemsQuery(companyId, {
      account: retentionAccount?.id,
      counterparty: clientId ?? undefined,
      // S12 rule 19: the project's own retentions, not the client's other projects'.
      contract: header.projectId ?? undefined,
      state: 'open',
    }),
    enabled:
      kind === 'retention_release' &&
      header.side === 'client' &&
      clientId !== null &&
      retentionAccount !== undefined,
  });
  const accountsById = new Map(accounts.map((account) => [account.id, account]));

  // A new draft saved for its preview: ask for it once its page opens.
  const asked = useRef(false);
  useEffect(() => {
    if (!runPreview || asked.current || !draft) return;
    asked.current = true;
    showPreview.mutate();
  });

  const setHeader = (change: Partial<EditDocument['header']>) =>
    setEdit((current) => ({ ...current, header: { ...current.header, ...change } }));
  const refuse = (key: string, error: boolean) =>
    setRefused((current) => {
      const next = new Set(current);
      if (error) next.add(key);
      else next.delete(key);
      return next;
    });
  const updatePurchase = (key: string, change: Partial<PurchaseLine>) =>
    setEdit((current) => ({
      ...current,
      purchaseLines: current.purchaseLines.map((line) =>
        line.key === key ? { ...line, ...change } : line,
      ),
    }));
  const updateWage = (key: string, change: Partial<WageLine>) =>
    setEdit((current) => ({
      ...current,
      wageLines: current.wageLines.map((line) =>
        line.key === key ? { ...line, ...change } : line,
      ),
    }));

  /** Rule 5 and the kind's fields, before a save that posts or submits. */
  function check(forPosting: boolean): Problems {
    const found: Problems = {};
    if (header.projectId === null) found.project = f.projectMissing;
    if (takesSupplier && header.counterpartyId === null) found.counterparty = f.supplierMissing;
    if ((kind === 'purchase' || kind === 'wage_sheet') && header.currency === null) {
      found.currency = f.currencyMissing;
    }
    if (kind === 'wage_sheet') {
      if (header.periodFrom === '' || header.periodTo === '') found.period = f.periodMissing;
      else if (header.periodFrom > header.periodTo) found.period = f.periodOrder;
      // S12 rule 10: the period lies in one calendar month.
      else if (header.periodFrom.slice(0, 7) !== header.periodTo.slice(0, 7)) {
        found.period = f.periodOneMonth;
      }
    } else if (edit.entryDate === '') {
      found.date = ar.drafts.editor.validation.date;
    }
    if (refused.size > 0) found.lines = ar.drafts.editor.fixBeforeSaving;
    if (!forPosting) return found;
    if (isBilling && header.cumulativeMinor === null) found.cumulative = f.cumulativeMissing;
    if (supplierSide && header.retentionMinor === null) found.released = f.amountMissing;
    if (kind === 'retention_release' && header.side === 'client') {
      if (!Object.values(edit.releases).some((amount) => amount !== null && amount > 0n)) {
        found.lines = f.releaseNone;
      }
    }
    if (kind === 'purchase') {
      const typed = edit.purchaseLines.filter((line) => !isBlankPurchaseLine(line));
      const missing = typed.length === 0 || typed.some((line) => purchaseProblem(line) !== null);
      if (missing && found.lines === undefined) found.lines = ar.drafts.editor.validation.lines;
    }
    if (kind === 'wage_sheet') {
      const typed = edit.wageLines.filter((line) => !isBlankWageLine(line));
      const missing = typed.length === 0 || typed.some((line) => wageProblem(line) !== null);
      if (missing && found.lines === undefined) found.lines = ar.drafts.editor.validation.lines;
    }
    return found;
  }

  function purchaseProblem(line: PurchaseLine): string | null {
    if (line.accountId === null) return f.accountMissing;
    const requires = accountsById.get(line.accountId)?.requiresMaterial ?? false;
    const quantity = quantityOf(line.quantity);
    if (requires) {
      if (line.materialId === null) return f.materialMissing;
      if (quantity === null) return f.quantityInvalid;
    } else if (line.quantity.trim() !== '' && quantity === null) {
      return f.quantityInvalid;
    }
    if (quantity !== null && !isZeroQuantity(quantity) && unitPriceOf(line.unitPrice) === null) {
      return f.unitPriceInvalid;
    }
    if (purchaseLineAmount(line, currency) === null) return f.amountMissing;
    return null;
  }

  function wageProblem(line: WageLine): string | null {
    if (line.workerId === null) return f.workerMissing;
    if (line.mode === 'days') {
      if (daysOf(line.days) === null) return f.daysInvalid;
      if (unitPriceOf(line.dailyRate) === null) return f.unitPriceInvalid;
      return null;
    }
    if (line.amountMinor === null) return f.amountMissing;
    if (line.description.trim() === '') return f.lumpDescriptionMissing;
    return null;
  }

  function refuseWith(found: Problems): boolean {
    setProblems(found);
    const ok = Object.values(found).every((problem) => problem === undefined);
    if (!ok) setAttempt((count) => count + 1);
    return ok;
  }

  /** The draft saved as typed: created by the first save, then updated with its `updatedAt`. */
  async function persist(): Promise<Draft> {
    if (!refuseWith(check(false))) throw new Incomplete();
    const input = documentInputOf(edit);
    const current = saved.current;
    if (current.draft && JSON.stringify(input) === current.body) return current.draft;
    const stored = current.draft
      ? await api('PUT', `/drafts/${current.draft.id}`, {
          company: companyId,
          body: { ...input, updatedAt: current.draft.updatedAt },
          schema: draftSchema,
        })
      : await api('POST', '/drafts', { company: companyId, body: input, schema: draftSchema });
    saved.current = { body: JSON.stringify(input), draft: stored };
    queryClient.setQueryData(draftQuery(companyId, stored.id).queryKey, stored);
    await queryClient.invalidateQueries({ queryKey: ['drafts', companyId, 'list'] });
    return stored;
  }

  async function openCreated(stored: Draft, then?: 'preview') {
    if (draft) return;
    await navigate({
      to: '/drafts/$id',
      params: { id: stored.id },
      search: then ? { open: then } : {},
      replace: true,
    });
  }

  const save = useMutation({
    mutationFn: persist,
    onSuccess: async (stored) => {
      setNotice('saved');
      await openCreated(stored);
    },
  });

  const showPreview = useMutation({
    mutationFn: async () => {
      const stored = editable ? await persist() : saved.current.draft;
      if (!stored) throw new Incomplete();
      if (!draft) return { stored, answer: null };
      const answer = await api('POST', `/drafts/${stored.id}/preview`, {
        company: companyId,
        schema: entryPreviewSchema,
      });
      return { stored, answer };
    },
    onSuccess: async ({ stored, answer }) => {
      if (answer) setPreview({ answer, body: JSON.stringify(documentInputOf(edit)) });
      else await openCreated(stored, 'preview');
    },
  });

  const afterPosting = async (entryId: string | null) => {
    await queryClient.invalidateQueries({ queryKey: ['entries', companyId] });
    await queryClient.invalidateQueries({ queryKey: ['drafts', companyId] });
    await queryClient.invalidateQueries({ queryKey: ['projects', companyId] });
    await queryClient.invalidateQueries({ queryKey: ['reports', companyId] });
    if (entryId) await navigate({ to: '/entries/$id', params: { id: entryId } });
    else await navigate({ to: '/projects/documents', search: {} });
  };

  const post = useMutation({
    mutationFn: async () => {
      if (!refuseWith(check(true))) throw new Incomplete();
      const stored = await persist();
      return api('POST', `/drafts/${stored.id}/post`, {
        company: companyId,
        body: { expectedMinor: null },
        schema: postedDraftSchema,
      });
    },
    onSuccess: (posted) => afterPosting(posted.entry?.id ?? null),
  });

  const transition = useMutation({
    mutationFn: async (step: 'submit' | 'withdraw' | 'approve') => {
      if (step === 'submit' && !refuseWith(check(true))) throw new Incomplete();
      const stored = step === 'submit' ? await persist() : saved.current.draft;
      if (!stored) throw new Incomplete();
      if (step === 'approve') {
        const posted = await api('POST', `/drafts/${stored.id}/approve`, {
          company: companyId,
          body: { expectedMinor: null },
          schema: postedDraftSchema,
        });
        return { draft: posted.draft, entryId: posted.entry?.id ?? null };
      }
      const next = await api('POST', `/drafts/${stored.id}/${step}`, {
        company: companyId,
        schema: draftSchema,
      });
      return { draft: next, entryId: null };
    },
    onSuccess: async ({ draft: next, entryId }) => {
      queryClient.setQueryData(draftQuery(companyId, next.id).queryKey, next);
      await queryClient.invalidateQueries({ queryKey: ['drafts', companyId, 'list'] });
      if (entryId) await afterPosting(entryId);
      else await openCreated(next);
    },
  });

  const busy = save.isPending || showPreview.isPending || post.isPending || transition.isPending;
  const failure = [save.error, showPreview.error, post.error, transition.error].find(
    (error) => error && !(error instanceof Incomplete),
  );

  function postOrSubmit() {
    if (busy || !editable) return;
    if (approval) {
      if (can(me, 'drafts.manage')) transition.mutate('submit');
    } else if (can(me, 'entries.post')) {
      post.mutate();
    }
  }

  // Save and post read the screen as rendered after the key, once a field committed its text.
  const latest = useRef({ save: () => {}, postOrSubmit: () => {} });
  latest.current = {
    save: () => {
      if (editable && !busy) save.mutate();
    },
    postOrSubmit,
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const native = event.nativeEvent;
    const action = matchesShortcut(native, keymap.save)
      ? 'save'
      : matchesShortcut(native, keymap.post)
        ? 'postOrSubmit'
        : null;
    if (!action) return;
    event.preventDefault();
    const target = event.target;
    if (target instanceof HTMLElement && target.tagName === 'INPUT') {
      target.blur();
      target.focus();
    }
    setTimeout(() => latest.current[action]());
  }

  const stale = preview !== null && preview.body !== body;
  const documentPreview = preview && !stale ? preview.answer.projectDocument : null;
  const minorOf = (value: string | null | undefined) =>
    value === null || value === undefined ? null : BigInt(value);
  const title = (draft ? f.draftTitle : f.newTitle).replace('{kind}', t.kinds[kind]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: save and post are component keys of the whole document form (ADR 0010 §4).
    <div className="flex min-w-0 flex-col gap-6" onKeyDown={onKeyDown}>
      <PageHeader
        back={<BackLink to="/drafts" label={ar.drafts.nav} />}
        title={title}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {draft && state === 'submitted' && <Badge tone="info">{f.awaiting}</Badge>}
            {dirty && editable && <Badge tone="warning">{ar.drafts.editor.unsaved}</Badge>}
          </div>
        }
      />
      {draft?.rejected && (
        <Callout
          tone="warning"
          icon={<TriangleAlertIcon />}
          title={f.rejected.replace('{reason}', draft.rejected.reason)}
        />
      )}
      {!editable && <Callout tone="info" icon={<InfoIcon />} title={f.readOnly} />}

      <FormErrorSummary
        attempt={attempt}
        errors={[
          ['document-project', problems.project],
          ['document-counterparty', problems.counterparty],
          ['document-currency', problems.currency],
          ['document-date', problems.date],
          ['document-period', problems.period],
          ['document-cumulative', problems.cumulative],
          ['document-released', problems.released],
          ['document-lines', problems.lines],
        ]}
      />

      <VoucherHeader
        kind={t.kinds[kind]}
        number={null}
        labels={{
          number: f.number,
          numberPending: f.numberPending,
          date: f.date,
          balance: ar.cash.position.balance,
        }}
      >
        <DimensionPicker
          id="document-project"
          label={f.project}
          values={pickerValues(projectCatalog.projects)}
          value={header.projectId}
          onValueChange={(id) =>
            // A release's amounts belong to the project's items: a new project starts them over.
            setEdit((current) => ({
              ...current,
              header: { ...current.header, projectId: id },
              releases: {},
            }))
          }
          labels={dimensionPickerLabels}
          required
          disabled={!editable}
          error={problems.project}
          description={project?.parentName ? `${f.client}: ${project.parentName}` : undefined}
        />
        {kind === 'retention_release' && (
          <SelectField
            label={f.side}
            value={header.side}
            options={RETENTION_SIDES.map((side) => ({ value: side, label: t.sides[side] }))}
            disabled={!editable}
            onValueChange={(side) =>
              setEdit((current) => ({
                ...current,
                header: {
                  ...current.header,
                  side: side as RetentionSide,
                  counterpartyId: null,
                  retentionMinor: null,
                },
                releases: {},
              }))
            }
          />
        )}
        {takesSupplier && (
          <DimensionPicker
            id="document-counterparty"
            label={kind === 'purchase' ? f.supplier : f.subcontractor}
            values={pickerValues(projectCatalog.counterparties('supplier'))}
            value={header.counterpartyId}
            onValueChange={(id) => setHeader({ counterpartyId: id })}
            labels={dimensionPickerLabels}
            required
            disabled={!editable}
            error={problems.counterparty}
          />
        )}
        {(kind === 'purchase' || kind === 'wage_sheet') && (
          <SelectField
            id="document-currency"
            label={f.currency}
            value={header.currency}
            options={currencyOptions}
            placeholder={ar.chart.sheet.choose}
            disabled={!editable}
            error={problems.currency}
            onValueChange={(value) => setHeader({ currency: value as CurrencyCode })}
          />
        )}
        {kind === 'wage_sheet' ? (
          <div className="flex min-w-0 flex-col gap-1">
            <DateRangeField
              id="document-period"
              tabIndex={-1}
              value={{ from: header.periodFrom, to: header.periodTo }}
              onValueChange={(range) => setHeader({ periodFrom: range.from, periodTo: range.to })}
              label={f.period}
              fromLabel={f.periodFrom}
              toLabel={f.periodTo}
              orderError={f.periodOrder}
              disabled={!editable}
            />
            <p className="text-control text-muted-foreground">{f.periodHint}</p>
            {problems.period && problems.period !== f.periodOrder && (
              <p className="text-control text-destructive-text">{problems.period}</p>
            )}
          </div>
        ) : (
          <Field id="document-date" invalid={problems.date !== undefined}>
            <FieldLabel>{f.date}</FieldLabel>
            <Input
              type="date"
              dir="ltr"
              value={edit.entryDate}
              readOnly={!editable}
              onChange={(event) => setEdit({ ...edit, entryDate: event.target.value })}
            />
            <FieldError match={problems.date !== undefined}>{problems.date}</FieldError>
          </Field>
        )}
        {kind === 'purchase' && (
          <Field>
            <FieldLabel>{f.supplierReference}</FieldLabel>
            <Input
              dir="auto"
              maxLength={60}
              value={header.supplierReference}
              readOnly={!editable}
              onChange={(event) => setHeader({ supplierReference: event.target.value })}
            />
          </Field>
        )}
        <Field className="sm:col-span-2">
          <FieldLabel>{f.description}</FieldLabel>
          <Input
            maxLength={500}
            value={edit.description}
            readOnly={!editable}
            onChange={(event) => setEdit({ ...edit, description: event.target.value })}
          />
          <FieldDescription>{f.descriptionHint}</FieldDescription>
        </Field>
      </VoucherHeader>

      {(kind === 'progress_billing' ||
        (kind === 'retention_release' && header.side === 'client')) &&
        header.projectId !== null &&
        terms.isSuccess &&
        termsOf === null && <TermsNotice projectId={header.projectId} text={f.noTerms} />}
      {(kind === 'subcontract_billing' || supplierSide) &&
        header.projectId !== null &&
        header.counterpartyId !== null &&
        subcontracts.isSuccess &&
        subcontract === undefined && (
          <TermsNotice projectId={header.projectId} text={f.noSubcontract} />
        )}

      <section
        id="document-lines"
        tabIndex={-1}
        aria-labelledby="document-lines-title"
        className="flex min-w-0 flex-col gap-3 outline-none"
      >
        <h2 id="document-lines-title" className="text-lg font-bold">
          {f.lines}
        </h2>
        {problems.lines && (
          <p role="alert" className="text-control text-destructive-text">
            {problems.lines}
          </p>
        )}
        {kind === 'purchase' && (
          <PurchaseLines
            lines={edit.purchaseLines}
            accounts={costAccounts(accounts)}
            accountsById={accountsById}
            materials={materialsRead.all}
            currency={currency}
            editable={editable}
            advanceMinor={header.advanceMinor}
            problemOf={purchaseProblem}
            showProblems={attempt > 0}
            onChange={updatePurchase}
            onRefused={refuse}
            onAdd={() =>
              setEdit((current) => ({
                ...current,
                purchaseLines: [...current.purchaseLines, emptyPurchaseLine()],
              }))
            }
            onRemove={(key) =>
              setEdit((current) => ({
                ...current,
                purchaseLines:
                  current.purchaseLines.length <= 1
                    ? [emptyPurchaseLine()]
                    : current.purchaseLines.filter((line) => line.key !== key),
              }))
            }
          />
        )}
        {kind === 'purchase' && (
          <Field className="max-w-sm">
            <FieldLabel>{f.advanceApplied}</FieldLabel>
            <AmountInput
              currency={currency ?? 'USD'}
              value={header.advanceMinor}
              allowNegative={false}
              readOnly={!editable}
              onValueChange={(advanceMinor) => setHeader({ advanceMinor })}
              onTextError={(error) => refuse('advance', error !== null)}
            />
            <FieldDescription>{f.advanceHint}</FieldDescription>
          </Field>
        )}
        {kind === 'wage_sheet' && (
          <WageLines
            lines={edit.wageLines}
            workers={projectCatalog.counterparties('worker')}
            currency={currency}
            editable={editable}
            problemOf={wageProblem}
            showProblems={attempt > 0}
            onChange={updateWage}
            onRefused={refuse}
            onAdd={() =>
              setEdit((current) => ({
                ...current,
                wageLines: [...current.wageLines, emptyWageLine()],
              }))
            }
            onRemove={(key) =>
              setEdit((current) => ({
                ...current,
                wageLines:
                  current.wageLines.length <= 1
                    ? [emptyWageLine()]
                    : current.wageLines.filter((line) => line.key !== key),
              }))
            }
          />
        )}
        {isBilling && (
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <Field id="document-cumulative" invalid={problems.cumulative !== undefined}>
              <FieldLabel>{f.cumulative}</FieldLabel>
              <AmountInput
                currency={currency ?? 'USD'}
                value={header.cumulativeMinor}
                allowNegative={false}
                readOnly={!editable || currency === null}
                onValueChange={(cumulativeMinor) => setHeader({ cumulativeMinor })}
                onTextError={(error) => refuse('cumulative', error !== null)}
              />
              <FieldDescription>
                {currency ? f.currencyOfTerms.replace('{currency}', currency) : f.cumulativeHint}
              </FieldDescription>
              <FieldError match={problems.cumulative !== undefined}>
                {problems.cumulative}
              </FieldError>
            </Field>
            {currency && (
              <BillingSummary
                currency={currency}
                labels={billingSummaryLabels}
                retentionRate={rateOf(
                  kind === 'progress_billing' ? termsOf?.retentionBp : subcontract?.retentionBp,
                )}
                recoveryRate={rateOf(
                  kind === 'progress_billing'
                    ? termsOf?.advanceRecoveryBp
                    : subcontract?.advanceRecoveryBp,
                )}
                figures={{
                  cumulativeMinor: header.cumulativeMinor,
                  previousMinor: minorOf(documentPreview?.previousMinor),
                  periodMinor: minorOf(documentPreview?.periodValueMinor),
                  retentionMinor: minorOf(documentPreview?.retentionMinor),
                  recoveryMinor: minorOf(documentPreview?.advanceMinor),
                  netMinor: minorOf(documentPreview?.netMinor),
                }}
                retentionField={
                  editable ? (
                    <DeductionInput
                      label={billingSummaryLabels.retention}
                      currency={currency}
                      value={header.retentionMinor}
                      onValueChange={(retentionMinor) => setHeader({ retentionMinor })}
                      onRefused={(error) => refuse('retention', error)}
                    />
                  ) : undefined
                }
                recoveryField={
                  editable ? (
                    <DeductionInput
                      label={billingSummaryLabels.recovery}
                      currency={currency}
                      value={header.advanceMinor}
                      onValueChange={(advanceMinor) => setHeader({ advanceMinor })}
                      onRefused={(error) => refuse('recovery', error)}
                    />
                  ) : undefined
                }
              />
            )}
            {editable && (
              <p className="text-control text-muted-foreground lg:col-span-2">{f.deductionHint}</p>
            )}
          </div>
        )}
        {supplierSide && (
          <Field
            id="document-released"
            className="max-w-sm"
            invalid={problems.released !== undefined}
          >
            <FieldLabel>{f.released}</FieldLabel>
            <AmountInput
              currency={currency ?? 'USD'}
              value={header.retentionMinor}
              allowNegative={false}
              readOnly={!editable}
              onValueChange={(retentionMinor) => setHeader({ retentionMinor })}
              onTextError={(error) => refuse('released', error !== null)}
            />
            <FieldDescription>{f.releasedHint}</FieldDescription>
            <FieldError match={problems.released !== undefined}>{problems.released}</FieldError>
          </Field>
        )}
        {kind === 'retention_release' && header.side === 'client' && (
          <RetentionReleases
            query={retentions}
            ready={clientId !== null}
            releases={edit.releases}
            editable={editable}
            onChange={(itemId, amount) =>
              setEdit((current) => ({
                ...current,
                releases: { ...current.releases, [itemId]: amount },
              }))
            }
            onRefused={refuse}
          />
        )}
      </section>

      <FormError error={failure} />
      {notice === 'saved' && !dirty && (
        <p role="status" className="flex items-center gap-2 text-control">
          <CircleCheckIcon aria-hidden="true" className="size-icon text-primary" />
          {f.saved}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <>
            <Button
              variant="outline"
              loading={save.isPending}
              disabled={busy}
              onClick={() => save.mutate()}
            >
              <SaveIcon aria-hidden="true" />
              {f.save}
              <Kbd shortcut={keymap.save} />
            </Button>
            <Button
              variant="outline"
              loading={showPreview.isPending}
              disabled={busy}
              onClick={() => showPreview.mutate()}
            >
              <EyeIcon aria-hidden="true" />
              {f.preview}
            </Button>
            {approval ? (
              <Button loading={transition.isPending} disabled={busy} onClick={postOrSubmit}>
                <SendIcon aria-hidden="true" />
                {f.submit}
                <Kbd shortcut={keymap.post} />
              </Button>
            ) : (
              can(me, 'entries.post') && (
                <Button loading={post.isPending} disabled={busy} onClick={postOrSubmit}>
                  <CheckIcon aria-hidden="true" />
                  {f.post}
                  <Kbd shortcut={keymap.post} />
                </Button>
              )
            )}
            {draft && (
              <Button variant="ghost" disabled={busy} onClick={() => setDialog('discard')}>
                <Trash2Icon aria-hidden="true" />
                {f.discard}
              </Button>
            )}
          </>
        )}
        {draft && state === 'submitted' && manage && draft.preparedBy.id === me.person.id && (
          <Button
            variant="outline"
            loading={transition.isPending}
            disabled={busy}
            onClick={() => transition.mutate('withdraw')}
          >
            <Undo2Icon aria-hidden="true" />
            {f.withdraw}
          </Button>
        )}
        {draft && state === 'submitted' && (
          <Button
            variant="outline"
            loading={showPreview.isPending}
            disabled={busy}
            onClick={() => showPreview.mutate()}
          >
            <EyeIcon aria-hidden="true" />
            {f.preview}
          </Button>
        )}
        {canApprove && !preparerOrSubmitter && (
          <>
            <Button
              loading={transition.isPending}
              disabled={busy}
              onClick={() => transition.mutate('approve')}
            >
              <CheckIcon aria-hidden="true" />
              {f.approve}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setDialog('reject')}>
              <XIcon aria-hidden="true" />
              {f.reject}
            </Button>
          </>
        )}
      </div>
      {canApprove && preparerOrSubmitter && (
        <Callout tone="info" icon={<InfoIcon />} title={ar.drafts.editor.selfApproval} />
      )}

      {preview && (
        <>
          <DocumentFigures preview={preview.answer} stale={stale} />
          <PreviewPanel preview={preview.answer} stale={stale} rowOf={(lineNo) => lineNo} />
        </>
      )}

      {draft && (
        <>
          <ReasonDialog
            open={dialog === 'reject'}
            onOpenChange={(next) => !next && setDialog(null)}
            title={ar.drafts.reject.title}
            description={ar.drafts.reject.description}
            reasonLabel={ar.drafts.reject.reason}
            submitLabel={ar.drafts.reject.submit}
            destructive
            onConfirm={(reason) =>
              api('POST', `/drafts/${draft.id}/reject`, {
                company: companyId,
                body: { reason },
                schema: draftSchema,
              })
            }
            onDone={() => queryClient.invalidateQueries({ queryKey: ['drafts', companyId] })}
          />
          <ConfirmDialog
            open={dialog === 'discard'}
            onOpenChange={(next) => !next && setDialog(null)}
            title={ar.drafts.discard.title}
            description={ar.drafts.discard.description}
            submitLabel={ar.drafts.discard.submit}
            destructive
            onConfirm={() =>
              api('POST', `/drafts/${draft.id}/discard`, {
                company: companyId,
                body: { reason: null },
                schema: draftSchema,
              })
            }
            onDone={async () => {
              await queryClient.invalidateQueries({ queryKey: ['drafts', companyId] });
              await navigate({ to: '/drafts', search: { view: 'all' } });
            }}
          />
        </>
      )}
    </div>
  );
}

const rateOf = (bp: number | undefined) =>
  bp === undefined ? undefined : `${basisPointsText(bp)}%`;

function TermsNotice({ projectId, text }: { projectId: string; text: string }) {
  return (
    <Callout
      tone="warning"
      icon={<TriangleAlertIcon />}
      title={text}
      description={
        <Link
          to="/projects/$valueId/terms"
          params={{ valueId: projectId }}
          className="text-primary underline underline-offset-4"
        >
          {f.toTerms}
        </Link>
      }
    />
  );
}

/** A billing's deduction as the accountant changes it; empty leaves it to the terms' rate. */
function DeductionInput({
  label,
  currency,
  value,
  onValueChange,
  onRefused,
}: {
  label: string;
  currency: CurrencyCode;
  value: bigint | null;
  onValueChange: (value: bigint | null) => void;
  onRefused: (error: boolean) => void;
}) {
  return (
    <AmountInput
      aria-label={label}
      className="max-w-40"
      currency={currency}
      value={value}
      allowNegative={false}
      placeholder={f.retentionAuto}
      onValueChange={onValueChange}
      onTextError={(error) => onRefused(error !== null)}
    />
  );
}

/** One line's card: its number, its fields and the way to remove it. */
function LineCard({
  no,
  editable,
  onRemove,
  problem,
  children,
}: {
  no: number;
  editable: boolean;
  onRemove: () => void;
  problem: string | null;
  children: ReactNode;
}) {
  const line = f.line.replace('{line}', String(no));
  return (
    <li>
      <Card className="flex flex-col gap-3 p-4" aria-label={line}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">{line}</h3>
          {editable && (
            <IconButton label={f.removeLine.replace('{line}', String(no))} onClick={onRemove}>
              <Trash2Icon />
            </IconButton>
          )}
        </div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
        {problem && <p className="text-control text-destructive-text">{problem}</p>}
      </Card>
    </li>
  );
}

function LinesFooter({
  editable,
  onAdd,
  total,
  currency,
}: {
  editable: boolean;
  onAdd: () => void;
  total: bigint | null;
  currency: CurrencyCode | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {editable && (
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <PlusIcon aria-hidden="true" />
          {f.addLine}
        </Button>
      )}
      {currency && total !== null && (
        <p className="ms-auto flex items-baseline gap-2 text-control">
          <span className="text-muted-foreground">{f.total}</span>
          <Amount value={total} currency={currency} showCurrency strong />
        </p>
      )}
    </div>
  );
}

const sumOf = (amounts: readonly (bigint | null)[], currency: CurrencyCode | null) =>
  currency === null
    ? null
    : (summarizeAmounts(
        amounts.flatMap((amount) => (amount === null ? [] : [money(amount, currency)])),
      ).find((sum) => sum.currency === currency)?.sumMinor ?? 0n);

/** A purchase's cost lines (rule 7): account, material, quantity × unit price, or an amount. */
function PurchaseLines({
  lines,
  accounts,
  accountsById,
  materials,
  currency,
  editable,
  advanceMinor,
  problemOf,
  showProblems,
  onChange,
  onRefused,
  onAdd,
  onRemove,
}: {
  lines: readonly PurchaseLine[];
  accounts: readonly Account[];
  accountsById: ReadonlyMap<string, Account>;
  materials: readonly {
    id: string;
    code: string;
    name: string;
    nameLatin: string | null;
    unit: string;
    archivedAt: string | null;
  }[];
  currency: CurrencyCode | null;
  editable: boolean;
  advanceMinor: bigint | null;
  problemOf: (line: PurchaseLine) => string | null;
  showProblems: boolean;
  onChange: (key: string, change: Partial<PurchaseLine>) => void;
  onRefused: (key: string, error: boolean) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
}) {
  const options = materials.map((material) => ({
    id: material.id,
    code: material.code,
    name: material.name,
    nameLatin: material.nameLatin,
    unit: material.unit,
    archived: material.archivedAt !== null,
  }));
  return (
    <>
      <ul className="flex flex-col gap-3">
        {lines.map((line, index) => {
          const no = index + 1;
          const requires = line.accountId
            ? (accountsById.get(line.accountId)?.requiresMaterial ?? false)
            : false;
          const quantity = quantityOf(line.quantity);
          const computed = quantity !== null && !isZeroQuantity(quantity);
          const amount = purchaseLineAmount(line, currency);
          return (
            <LineCard
              key={line.key}
              no={no}
              editable={editable}
              onRemove={() => onRemove(line.key)}
              problem={showProblems && !isBlankPurchaseLine(line) ? problemOf(line) : null}
            >
              <AccountPicker
                label={`${f.account} ${no}`}
                className="sm:col-span-2"
                accounts={pickerAccounts(accounts)}
                value={line.accountId}
                labels={accountPickerLabels}
                disabled={!editable}
                onValueChange={(accountId) =>
                  // S12 rule 4: a material only on an account that requires one.
                  onChange(
                    line.key,
                    accountsById.get(accountId)?.requiresMaterial
                      ? { accountId }
                      : { accountId, materialId: null, unit: null },
                  )
                }
              />
              {requires && (
                <MaterialPicker
                  label={`${f.material} ${no}`}
                  className="sm:col-span-2"
                  materials={options}
                  value={line.materialId}
                  labels={ar.materials.picker}
                  disabled={!editable}
                  onValueChange={(material) =>
                    onChange(line.key, { materialId: material.id, unit: material.unit })
                  }
                />
              )}
              <Field>
                <FieldLabel>{`${f.quantity} ${no}`}</FieldLabel>
                <Input
                  dir="ltr"
                  inputMode="decimal"
                  value={line.quantity}
                  readOnly={!editable}
                  onChange={(event) => onChange(line.key, { quantity: event.target.value })}
                />
                <FieldDescription>
                  {line.unit && requires ? `${ar.materials.unit}: ${line.unit}` : f.quantityHint}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel>{`${f.unitPrice} ${no}`}</FieldLabel>
                <Input
                  dir="ltr"
                  inputMode="decimal"
                  value={line.unitPrice}
                  readOnly={!editable}
                  onChange={(event) => onChange(line.key, { unitPrice: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel>{`${f.amount} ${no}`}</FieldLabel>
                {computed ? (
                  <p className="flex h-control items-center" data-slot="line-amount">
                    {amount !== null && currency ? (
                      <Amount value={amount} currency={currency} showCurrency />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </p>
                ) : (
                  <AmountInput
                    currency={currency ?? 'USD'}
                    value={line.amountMinor}
                    readOnly={!editable}
                    onValueChange={(amountMinor) => onChange(line.key, { amountMinor })}
                    onTextError={(error) => onRefused(`amount:${line.key}`, error !== null)}
                  />
                )}
                <FieldDescription>
                  {computed
                    ? f.amountComputed
                    : quantity !== null
                      ? ar.materials.priceAdjustment
                      : undefined}
                </FieldDescription>
              </Field>
              {advanceMinor !== null && (
                <Field>
                  <FieldLabel>{`${f.covered} ${no}`}</FieldLabel>
                  <AmountInput
                    currency={currency ?? 'USD'}
                    value={line.advanceMinor}
                    allowNegative={false}
                    readOnly={!editable}
                    onValueChange={(next) => onChange(line.key, { advanceMinor: next })}
                    onTextError={(error) => onRefused(`covered:${line.key}`, error !== null)}
                  />
                  <FieldDescription>{f.coveredHint}</FieldDescription>
                </Field>
              )}
              <Field className="sm:col-span-2">
                <FieldLabel>{`${f.memo} ${no}`}</FieldLabel>
                <Input
                  maxLength={300}
                  value={line.memo}
                  readOnly={!editable}
                  onChange={(event) => onChange(line.key, { memo: event.target.value })}
                />
              </Field>
            </LineCard>
          );
        })}
      </ul>
      <LinesFooter
        editable={editable}
        onAdd={onAdd}
        currency={currency}
        total={sumOf(
          lines.map((line) => purchaseLineAmount(line, currency)),
          currency,
        )}
      />
    </>
  );
}

/** A wage sheet's lines (rule 10): a worker, then days × daily rate or a lump sum. */
function WageLines({
  lines,
  workers,
  currency,
  editable,
  problemOf,
  showProblems,
  onChange,
  onRefused,
  onAdd,
  onRemove,
}: {
  lines: readonly WageLine[];
  workers: Parameters<typeof pickerValues>[0];
  currency: CurrencyCode | null;
  editable: boolean;
  problemOf: (line: WageLine) => string | null;
  showProblems: boolean;
  onChange: (key: string, change: Partial<WageLine>) => void;
  onRefused: (key: string, error: boolean) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
}) {
  const modeOptions = (['days', 'lump'] as const).map((mode) => ({
    value: mode,
    label: f.modes[mode],
  }));
  return (
    <>
      <ul className="flex flex-col gap-3">
        {lines.map((line, index) => {
          const no = index + 1;
          const amount = wageLineAmount(line, currency);
          return (
            <LineCard
              key={line.key}
              no={no}
              editable={editable}
              onRemove={() => onRemove(line.key)}
              problem={showProblems && !isBlankWageLine(line) ? problemOf(line) : null}
            >
              <DimensionPicker
                label={`${f.worker} ${no}`}
                className="sm:col-span-2"
                values={pickerValues(workers)}
                value={line.workerId}
                onValueChange={(workerId) => onChange(line.key, { workerId })}
                labels={dimensionPickerLabels}
                required
                disabled={!editable}
              />
              <SelectField
                label={`${f.mode} ${no}`}
                value={line.mode}
                options={modeOptions}
                disabled={!editable}
                onValueChange={(mode) => onChange(line.key, { mode: mode as WageLine['mode'] })}
              />
              {line.mode === 'days' ? (
                <>
                  <Field>
                    <FieldLabel>{`${f.days} ${no}`}</FieldLabel>
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      value={line.days}
                      readOnly={!editable}
                      onChange={(event) => onChange(line.key, { days: event.target.value })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>{`${f.dailyRate} ${no}`}</FieldLabel>
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      value={line.dailyRate}
                      readOnly={!editable}
                      onChange={(event) => onChange(line.key, { dailyRate: event.target.value })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>{`${f.amount} ${no}`}</FieldLabel>
                    <p className="flex h-control items-center" data-slot="line-amount">
                      {amount !== null && currency ? (
                        <Amount value={amount} currency={currency} showCurrency />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </p>
                  </Field>
                </>
              ) : (
                <>
                  <Field>
                    <FieldLabel>{`${f.lumpSum} ${no}`}</FieldLabel>
                    <AmountInput
                      currency={currency ?? 'USD'}
                      value={line.amountMinor}
                      allowNegative={false}
                      readOnly={!editable}
                      onValueChange={(amountMinor) => onChange(line.key, { amountMinor })}
                      onTextError={(error) => onRefused(`lump:${line.key}`, error !== null)}
                    />
                  </Field>
                  <Field className="sm:col-span-2">
                    <FieldLabel>{`${f.lumpDescription} ${no}`}</FieldLabel>
                    <Input
                      maxLength={300}
                      value={line.description}
                      readOnly={!editable}
                      onChange={(event) => onChange(line.key, { description: event.target.value })}
                    />
                  </Field>
                </>
              )}
            </LineCard>
          );
        })}
      </ul>
      <LinesFooter
        editable={editable}
        onAdd={onAdd}
        currency={currency}
        total={sumOf(
          lines.map((line) => wageLineAmount(line, currency)),
          currency,
        )}
      />
    </>
  );
}

/** A client's release (rule 19): the client's open retentions, each with the amount released. */
function RetentionReleases({
  query,
  ready,
  releases,
  editable,
  onChange,
  onRefused,
}: {
  query: UseQueryResult<OpenItemPage>;
  ready: boolean;
  releases: Readonly<Record<string, bigint | null>>;
  editable: boolean;
  onChange: (itemId: string, amount: bigint | null) => void;
  onRefused: (key: string, error: boolean) => void;
}) {
  if (!ready) return <EmptyState title={f.projectMissing} />;
  if (query.isPending) return <Skeleton className="h-row" />;
  if (query.isError) return <FormError error={query.error} />;
  const items = query.data.items;
  if (items.length === 0) return <EmptyState title={f.retentionsEmpty} />;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {editable && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => {
            for (const item of items) onChange(item.id, BigInt(item.amounts.openMinor));
          }}
        >
          {f.releaseAll}
        </Button>
      )}
      <Table aria-label={f.retentions}>
        <TableHeader>
          <TableRow>
            <TableHead>{f.retentionItem}</TableHead>
            <TableHead numeric>{f.retentionOpen}</TableHead>
            <TableHead numeric>{f.retentionRelease}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const amount = releases[item.id] ?? null;
            return (
              <TableRow key={item.id}>
                <TableCell>
                  <bdi className="font-medium">{item.reference}</bdi>
                </TableCell>
                <TableCell numeric>
                  <Amount
                    value={BigInt(item.amounts.openMinor)}
                    currency={item.currency}
                    showCurrency
                  />
                </TableCell>
                <TableCell numeric>
                  <AmountInput
                    aria-label={`${f.retentionRelease} ${item.reference}`}
                    className="ms-auto max-w-40"
                    currency={item.currency}
                    value={amount}
                    allowNegative={false}
                    readOnly={!editable}
                    onValueChange={(next) => onChange(item.id, next)}
                    onTextError={(error) => onRefused(`release:${item.id}`, error !== null)}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** The document's figures as the preview gives them (S12 "API"), and its warnings. */
function DocumentFigures({ preview, stale }: { preview: EntryPreview; stale: boolean }) {
  const figures = preview.projectDocument;
  if (!figures || preview.refusals.length > 0 || stale) return null;
  const p = t.preview;
  const { currency } = figures;
  const rows: [string, string | null][] = [
    [p.total, figures.totalMinor],
    [p.previous, figures.previousMinor],
    [p.period, figures.periodValueMinor],
    [p.retention, figures.retentionMinor],
    [p.advance, figures.advanceMinor],
    [p.net, figures.netMinor],
  ];
  return (
    <Card data-slot="document-figures">
      <CardHeader>
        <CardTitle>{p.figures}</CardTitle>
        {figures.warnings.length > 0 && (
          <CardDescription>
            {figures.warnings.map((warning) => (
              <Callout
                key={warning}
                tone="warning"
                icon={<TriangleAlertIcon />}
                title={p.warnings[warning]}
              />
            ))}
          </CardDescription>
        )}
      </CardHeader>
      {currency && (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 px-6 pb-6 text-control">
          {rows.map(([label, value]) =>
            value === null ? null : (
              <div key={label} className="flex items-baseline gap-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd>
                  <Amount value={BigInt(value)} currency={currency} showCurrency />
                </dd>
              </div>
            ),
          )}
        </dl>
      )}
    </Card>
  );
}
