import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  type Account,
  balancingAmount,
  type Company,
  CURRENCY_CODES,
  type CurrencyCode,
  type Draft,
  debitCreditOf,
  draftSchema,
  type EntryPreview,
  entryPreviewSchema,
  entryTotals,
  money,
  postedDraftSchema,
  signedAmount,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  AccountPicker,
  AmountInput,
  Badge,
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  type CellEdit,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DimensionPicker,
  EntryTotals,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Grid,
  type GridColumnDef,
  type GridHandle,
  type GridProblem,
  gridCellOf,
  IconButton,
  Input,
  Kbd,
  keymap,
  matchesShortcut,
  PageHeader,
  RateInput,
  SelectField,
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
import { api, hasCode } from '../../lib/api';
import { damascusToday, formatDateTime } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { ratePairsQuery } from '../rates/rate-queries';
import {
  dealtRatePairs,
  dimensionColumns,
  draftInputOf,
  type EditDraft,
  type EditLine,
  editDraftOf,
  emptyLine,
  findDimensionValue,
  isBlankLine,
  isCompleteLine,
  lineValueOf,
  newDraft,
  withDimensionValue,
} from './draft-lines';
import {
  AttachmentsCard,
  accountPickerLabels,
  BackLink,
  dimensionPickerLabels,
  EntryNumberText,
  pickerAccounts,
  pickerValues,
  useFiscalYearStartMonth,
} from './entry-parts';
import { draftQuery, entryQuery, useDimensionCatalog } from './entry-queries';
import { PreviewPanel, Refusals } from './preview-panel';

const t = ar.drafts;
const te = t.editor;

/** A grid row: the line with its number. */
type Row = EditLine & { readonly no: number };

/** The open picker of a line's account or dimension (Alt+↓, or a tap on a phone). */
type Lookup = { readonly key: string; readonly column: string };

/** What the client checks before a post or a submit (rule 5); the API checks it again. */
interface Problems {
  date?: string | undefined;
  description?: string | undefined;
  lines?: string | undefined;
}

/**
 * The keyboard entry screen (S03 F05, rules 4–17): the header, a `Grid` of lines (one card per
 * line on a phone), live totals per currency, dealt rates, the preview, attachments, and the
 * draft's actions by its state, the approval switch and the person's access. `draft` is null for
 * `/entries/new`: the first save creates it.
 */
export function EntryEditor({
  draft,
  company,
  accounts,
  runPreview = false,
  onReload,
}: {
  draft: Draft | null;
  company: Company;
  accounts: readonly Account[];
  /** Preview at once: a new draft saved for its preview opens here with the preview asked. */
  runPreview?: boolean;
  /** Reads the draft again and starts the screen over from it (after `DRAFT_CHANGED`). */
  onReload?: (() => void) | undefined;
}) {
  const { companyId, me, membership } = useCompany();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const catalog = useDimensionCatalog(companyId);
  const pairs = useQuery(ratePairsQuery(companyId)).data ?? [];
  const startMonth = useFiscalYearStartMonth(companyId);
  const [edit, setEdit] = useState<EditDraft>(() =>
    draft ? editDraftOf(draft) : newDraft(damascusToday()),
  );
  const reversal = draft?.reversesEntryId != null;
  const initialBody = useRef(JSON.stringify(draftInputOf(edit, reversal)));
  const saved = useRef<{ body: string; draft: Draft | null }>({
    body: draft ? initialBody.current : '',
    draft,
  });
  const [gridRefusal, setGridRefusal] = useState<GridProblem | null>(null);
  const [amountErrors, setAmountErrors] = useState<ReadonlySet<string>>(new Set());
  const [rateErrors, setRateErrors] = useState<ReadonlySet<string>>(new Set());
  const [problems, setProblems] = useState<Problems>({});
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<{ answer: EntryPreview; body: string } | null>(null);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [notice, setNotice] = useState<'saved' | null>(null);
  const [dialog, setDialog] = useState<'discard' | 'reject' | null>(null);
  const grid = useRef<GridHandle>(null);

  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const accountsByCode = new Map(accounts.map((account) => [account.code, account]));
  const active = !membership.company.archived;
  const state = draft?.state ?? 'draft';
  const open = state === 'draft' && !draft?.archived;
  const manage = active && can(me, 'drafts.manage');
  const editable = manage && open;
  const linesEditable = editable && !reversal;
  const approval = company.manualEntryApproval;
  const body = JSON.stringify(draftInputOf(edit, reversal));
  const dirty = body !== saved.current.body;
  const holdsRefusedText = gridRefusal !== null || amountErrors.size > 0 || rateErrors.size > 0;
  const preparerOrSubmitter =
    draft !== null &&
    (draft.preparedBy.id === me.person.id || draft.submitted?.by.id === me.person.id);
  const canApprove =
    active && draft !== null && state === 'submitted' && can(me, 'entries.approve');

  const bookCurrency = company.ledgers.book.currency;
  const rows: Row[] = edit.lines.map((line, index) => ({ ...line, no: index + 1 }));
  const dimensionTypes = dimensionColumns(edit.lines, accountsById, catalog.types, catalog.byId);
  const dealt = dealtRatePairs(edit, company.ledgers, pairs);
  const amounts = edit.lines.flatMap((line) =>
    line.currency === null || line.amountMinor === null
      ? []
      : [money(line.amountMinor, line.currency)],
  );

  // A new draft saved for its preview: ask for it once its page opens.
  const asked = useRef(false);
  useEffect(() => {
    if (!runPreview || asked.current || !draft) return;
    asked.current = true;
    showPreview.mutate();
  });

  function setLines(change: (lines: readonly EditLine[]) => readonly EditLine[]) {
    setEdit((current) => ({ ...current, lines: change(current.lines) }));
  }

  function updateLine(key: string, change: (line: EditLine) => EditLine) {
    setLines((lines) => lines.map((line) => (line.key === key ? change(line) : line)));
  }

  /** The line with an account chosen: its currency defaults to the account's, or the book's. */
  function withAccount(line: EditLine, account: Account | null): EditLine {
    if (!account) return { ...line, accountId: null };
    return {
      ...line,
      accountId: account.id,
      currency: line.currency ?? account.currency ?? bookCurrency,
    };
  }

  /** The line with a magnitude typed in its debit or credit column; empty clears that side. */
  function withSide(line: EditLine, side: 'debit' | 'credit', magnitude: bigint | null): EditLine {
    const current = debitCreditOf(line.amountMinor);
    const held = side === 'debit' ? current.debitMinor : current.creditMinor;
    if (magnitude === null || magnitude === 0n) {
      return held === null ? line : { ...line, amountMinor: null };
    }
    return { ...line, amountMinor: signedAmount(side, magnitude) };
  }

  /** The magnitude `=` puts in a side: what balances the line's currency, if on that side. */
  function balancingSide(line: EditLine, side: 'debit' | 'credit'): bigint | null {
    const currency = line.currency ?? bookCurrency;
    const others = edit.lines.flatMap((other) =>
      other.key === line.key || other.currency !== currency || other.amountMinor === null
        ? []
        : [money(other.amountMinor, currency)],
    );
    const needed = debitCreditOf(balancingAmount(others, currency));
    const magnitude = side === 'debit' ? needed.debitMinor : needed.creditMinor;
    return magnitude === null || magnitude === 0n ? null : magnitude;
  }

  const columns: GridColumnDef<Row>[] = [
    {
      id: 'no',
      type: 'text',
      header: te.lineNumber,
      readOnly: true,
      value: (row) => String(row.no),
      render: (row) => <bdi dir="ltr">{row.no}</bdi>,
    },
    {
      id: 'account',
      type: 'text',
      header: te.account,
      readOnly: !linesEditable,
      value: (row) => (row.accountId ? (accountsById.get(row.accountId)?.code ?? '') : ''),
      validate: (text) => accountProblem(text.trim(), accountsByCode),
      render: (row) => {
        const account = row.accountId ? accountsById.get(row.accountId) : undefined;
        return account ? (
          <AccountLabel code={account.code} name={account.name} className="max-w-64" />
        ) : null;
      },
    },
    ...dimensionTypes.map(
      (type): GridColumnDef<Row> => ({
        id: `dim:${type.id}`,
        type: 'text',
        header: <bdi>{type.name}</bdi>,
        readOnly: !linesEditable,
        value: (row) => {
          const value = lineValueOf(row, type.id, catalog.byId);
          return value ? (value.code ?? value.name) : '';
        },
        validate: (text) =>
          text.trim() === '' || findDimensionValue(catalog.valuesOf(type.id), text)
            ? undefined
            : te.dimensionUnknown,
        render: (row) => {
          const value = lineValueOf(row, type.id, catalog.byId);
          return value ? <bdi>{value.name}</bdi> : null;
        },
      }),
    ),
    {
      id: 'currency',
      type: 'text',
      header: te.currency,
      readOnly: !linesEditable,
      value: (row) => row.currency ?? '',
      validate: (text) =>
        text.trim() === '' || CURRENCY_CODES.includes(text.trim().toUpperCase() as CurrencyCode)
          ? undefined
          : te.currencyUnknown,
      render: (row) => <bdi dir="ltr">{row.currency}</bdi>,
    },
    ...(['debit', 'credit'] as const).map(
      (side): GridColumnDef<Row> => ({
        id: side,
        type: 'amount',
        kind: 'transaction',
        header: side === 'debit' ? te.debit : te.credit,
        readOnly: !linesEditable,
        allowNegative: false,
        currency: (row) => row.currency ?? bookCurrency,
        valueMinor: (row) => {
          const sides = debitCreditOf(row.amountMinor);
          return side === 'debit' ? sides.debitMinor : sides.creditMinor;
        },
        balancingMinor: (row) => balancingSide(row, side),
      }),
    ),
    {
      id: 'memo',
      type: 'text',
      header: te.memo,
      readOnly: !linesEditable,
      value: (row) => row.memo,
      validate: (text) => (text.trim().length > 300 ? te.memoTooLong : undefined),
      render: (row) => <bdi className="block max-w-64 truncate">{row.memo}</bdi>,
    },
  ];

  function applyEdits(edits: readonly CellEdit[]) {
    setLines((lines) => {
      const next = [...lines];
      for (const cell of edits) {
        const line = next[cell.row];
        const column = columns[cell.column]?.id;
        if (!line || !column) continue;
        if (cell.type === 'amount') {
          if (column === 'debit' || column === 'credit') {
            next[cell.row] = withSide(line, column, cell.amountMinor);
          }
          continue;
        }
        const text = cell.text.trim();
        if (column === 'account') {
          next[cell.row] = withAccount(
            line,
            text === '' ? null : (accountsByCode.get(text) ?? null),
          );
        } else if (column.startsWith('dim:')) {
          const typeId = column.slice(4);
          const value =
            text === '' ? undefined : findDimensionValue(catalog.valuesOf(typeId), text);
          next[cell.row] = withDimensionValue(line, typeId, value?.id ?? null, catalog.byId);
        } else if (column === 'currency') {
          next[cell.row] = {
            ...line,
            currency: text === '' ? null : (text.toUpperCase() as CurrencyCode),
          };
        } else if (column === 'memo') {
          next[cell.row] = { ...line, memo: cell.text };
        }
      }
      return next;
    });
  }

  function addLine(focus: boolean) {
    if (edit.lines.length >= 500) return;
    const line = emptyLine();
    setLines((lines) => [...lines, line]);
    if (focus) grid.current?.focusCell({ row: edit.lines.length, column: 1 });
  }

  function removeLine(key: string) {
    setLines((lines) =>
      lines.length <= 1 ? [emptyLine()] : lines.filter((line) => line.key !== key),
    );
  }

  /** The draft saved as typed: created by the first save, then updated with its `updatedAt`. */
  async function persist(): Promise<Draft> {
    if (holdsRefusedText) throw new RefusedText();
    const input = draftInputOf(edit, reversal);
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

  /** After a write, the page of a draft the first save created. */
  async function openCreated(stored: Draft, then?: 'preview') {
    if (draft) return;
    await navigate({
      to: '/drafts/$id',
      params: { id: stored.id },
      search: then ? { open: then } : {},
      replace: true,
    });
  }

  /** Rule 5, before a post or a submit: the date, the description, two complete lines. */
  function readyToPost(): boolean {
    const typed = edit.lines.filter((line) => !isBlankLine(line));
    const found: Problems = {
      date: edit.entryDate === '' ? te.validation.date : undefined,
      description:
        edit.description.trim() === ''
          ? te.validation.statement
          : edit.description.trim().length > 500
            ? te.validation.statementLength
            : undefined,
      lines:
        reversal || (typed.length >= 2 && typed.every(isCompleteLine) && !holdsRefusedText)
          ? undefined
          : holdsRefusedText
            ? te.fixBeforeSaving
            : te.validation.lines,
    };
    setProblems(found);
    const ok = !found.date && !found.description && !found.lines;
    if (!ok) setAttempt((count) => count + 1);
    return ok;
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
      const stored = await persist();
      if (!draft) return { stored, answer: null };
      const answer = await api('POST', `/drafts/${stored.id}/preview`, {
        company: companyId,
        schema: entryPreviewSchema,
      });
      return { stored, answer };
    },
    onSuccess: async ({ stored, answer }) => {
      if (answer) setPreview({ answer, body: JSON.stringify(draftInputOf(edit, reversal)) });
      else await openCreated(stored, 'preview');
    },
  });

  const post = useMutation({
    mutationFn: async () => {
      const stored = await persist();
      return api('POST', `/drafts/${stored.id}/post`, {
        company: companyId,
        schema: postedDraftSchema,
      });
    },
    onSuccess: async (posted) => {
      await queryClient.invalidateQueries({ queryKey: ['entries', companyId] });
      await queryClient.invalidateQueries({ queryKey: ['drafts', companyId] });
      await navigate({ to: '/entries/$id', params: { id: posted.entry.id } });
    },
  });

  /** A state change of a saved draft: submit, withdraw, approve, reject, discard. */
  const transition = useMutation({
    mutationFn: async (step: 'submit' | 'withdraw' | 'approve') => {
      const stored = step === 'submit' ? await persist() : saved.current.draft;
      if (!stored) throw new RefusedText();
      if (step === 'approve') {
        const posted = await api('POST', `/drafts/${stored.id}/approve`, {
          company: companyId,
          schema: postedDraftSchema,
        });
        return { draft: posted.draft, entryId: posted.entry.id };
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
      if (entryId) {
        await queryClient.invalidateQueries({ queryKey: ['entries', companyId] });
        await navigate({ to: '/entries/$id', params: { id: entryId } });
      } else {
        await openCreated(next);
      }
    },
  });

  const busy = save.isPending || showPreview.isPending || post.isPending || transition.isPending;
  const failure = save.error ?? showPreview.error ?? post.error ?? transition.error;

  function postOrSubmit() {
    if (busy || !editable || !readyToPost()) return;
    if (approval) {
      if (can(me, 'drafts.manage')) transition.mutate('submit');
    } else if (can(me, 'entries.post')) {
      post.mutate();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const native = event.nativeEvent;
    if (matchesShortcut(native, keymap.save)) {
      event.preventDefault();
      if (editable && !busy) save.mutate();
      return;
    }
    if (matchesShortcut(native, keymap.post)) {
      event.preventDefault();
      postOrSubmit();
      return;
    }
    const cell = gridCellOf(event.target);
    const line = cell ? edit.lines[cell.row] : undefined;
    if (!linesEditable) return;
    if (matchesShortcut(native, keymap.addLine)) {
      event.preventDefault();
      addLine(true);
    } else if (cell && line && matchesShortcut(native, keymap.deleteLine)) {
      event.preventDefault();
      removeLine(line.key);
      grid.current?.focusCell({
        row: Math.max(0, Math.min(cell.row, edit.lines.length - 2)),
        column: cell.column,
      });
    } else if (cell && line && matchesShortcut(native, keymap.insertLine)) {
      event.preventDefault();
      setLines((lines) => [...lines.slice(0, cell.row), emptyLine(), ...lines.slice(cell.row)]);
      grid.current?.focusCell({ row: cell.row, column: 1 });
    } else if (cell && line && matchesShortcut(native, keymap.lookup)) {
      const column = columns[cell.column]?.id;
      if (column === 'account' || column?.startsWith('dim:')) {
        event.preventDefault();
        setLookup({ key: line.key, column });
      }
    }
  }

  const lookupLine = lookup ? edit.lines.find((line) => line.key === lookup.key) : undefined;
  const closeLookup = () => {
    const row = lookup ? edit.lines.findIndex((line) => line.key === lookup.key) : -1;
    const column = lookup ? columns.findIndex((candidate) => candidate.id === lookup.column) : -1;
    setLookup(null);
    if (row >= 0 && column >= 0) grid.current?.focusCell({ row, column });
  };
  const title = draft ? (reversal ? te.reversalTitle : te.title) : te.newTitle;
  const stalePreview = preview !== null && preview.body !== body;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the entry keys (save, post, lines) are component keys of the whole entry screen (ADR 0010 §4).
    <div className="flex min-w-0 flex-col gap-6" onKeyDown={onKeyDown}>
      <PageHeader
        back={<BackLink to="/drafts" label={t.nav} />}
        title={title}
        description={te.description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {draft && <DraftBadges draft={draft} />}
            {dirty && editable && <Badge tone="warning">{te.unsaved}</Badge>}
          </div>
        }
      />
      <Notes draft={draft} reversal={reversal} startMonth={startMonth} />
      {!manage && <Callout tone="info" icon={<InfoIcon />} title={te.readOnly} />}

      <FormErrorSummary
        attempt={attempt}
        errors={[
          ['draft-date', problems.date],
          ['draft-description', problems.description],
          ['draft-lines', problems.lines],
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>{te.header}</CardTitle>
        </CardHeader>
        <div className="grid gap-4 px-6 pb-6 md:grid-cols-3">
          <Field id="draft-date" invalid={problems.date !== undefined}>
            <FieldLabel>{te.date}</FieldLabel>
            <Input
              type="date"
              dir="ltr"
              value={edit.entryDate}
              readOnly={!editable}
              onChange={(event) => setEdit({ ...edit, entryDate: event.target.value })}
            />
            <FieldDescription>{te.dateHint}</FieldDescription>
            <FieldError match={problems.date !== undefined}>{problems.date}</FieldError>
          </Field>
          <Field
            id="draft-description"
            className="md:col-span-2"
            invalid={problems.description !== undefined}
          >
            <FieldLabel>{te.statement}</FieldLabel>
            <Input
              value={edit.description}
              maxLength={500}
              readOnly={!editable}
              onChange={(event) => setEdit({ ...edit, description: event.target.value })}
            />
            <FieldDescription>{te.statementHint}</FieldDescription>
            <FieldError match={problems.description !== undefined}>
              {problems.description}
            </FieldError>
          </Field>
          <Field className="md:col-span-3 lg:col-span-1">
            <FieldLabel>{te.reference}</FieldLabel>
            <Input
              value={edit.reference}
              maxLength={100}
              readOnly={!editable}
              onChange={(event) => setEdit({ ...edit, reference: event.target.value })}
            />
            <FieldDescription>{te.referenceHint}</FieldDescription>
          </Field>
        </div>
      </Card>

      {!reversal && (
        <section
          id="draft-lines"
          tabIndex={-1}
          aria-labelledby="draft-lines-title"
          className="flex min-w-0 flex-col gap-3 outline-none"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="draft-lines-title" className="text-lg font-bold">
              {te.lines}
            </h2>
            {linesEditable && (
              <Button variant="outline" size="sm" onClick={() => addLine(false)}>
                <PlusIcon aria-hidden="true" />
                {te.addLine}
                <Kbd shortcut={keymap.addLine} />
              </Button>
            )}
          </div>
          {problems.lines && (
            <p className="text-destructive-text" role="alert">
              {problems.lines}
            </p>
          )}
          <Grid
            className="max-h-[32rem] max-md:hidden"
            aria-labelledby="draft-lines-title"
            rows={rows}
            columns={columns}
            rowKey={(row) => row.key}
            enterMoves="next"
            handle={grid}
            stickyStartColumn
            describeProblem={gridProblemText}
            summaryLabels={ar.grid.summary}
            {...(linesEditable ? { onEdit: applyEdits, onEditError: setGridRefusal } : {})}
          />
          <LineCards
            className="md:hidden"
            lines={edit.lines}
            editable={linesEditable}
            accounts={accounts}
            accountsById={accountsById}
            dimensionTypes={dimensionTypes}
            catalog={catalog}
            bookCurrency={bookCurrency}
            onAccount={(key, account) => updateLine(key, (line) => withAccount(line, account))}
            onDimension={(key, typeId, valueId) =>
              updateLine(key, (line) => withDimensionValue(line, typeId, valueId, catalog.byId))
            }
            onCurrency={(key, currency) => updateLine(key, (line) => ({ ...line, currency }))}
            onSide={(key, side, magnitude) =>
              updateLine(key, (line) => withSide(line, side, magnitude))
            }
            onMemo={(key, memo) => updateLine(key, (line) => ({ ...line, memo }))}
            onRemove={removeLine}
            onAdd={() => addLine(false)}
            onAmountError={(key, refused) =>
              setAmountErrors((current) => toggled(current, key, refused))
            }
          />
          {amounts.length === 0 ? (
            <p className="text-muted-foreground">{te.noTotals}</p>
          ) : (
            <EntryTotals totals={entryTotals(amounts)} labels={te.totals} />
          )}
        </section>
      )}

      {!reversal && dealt.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{te.dealtRates}</CardTitle>
            <CardDescription>{te.dealtRatesHint}</CardDescription>
          </CardHeader>
          <div className="flex flex-wrap gap-4 px-6 pb-6">
            {dealt.map((rate) => {
              const pair = `${rate.base}/${rate.quote}`;
              const refused = rateErrors.has(pair);
              return (
                <Field key={pair} className="w-60" invalid={refused}>
                  <FieldLabel>
                    {`${te.dealtRate} `}
                    <bdi dir="ltr">{`1 ${rate.base} = ? ${rate.quote}`}</bdi>
                  </FieldLabel>
                  <RateInput
                    value={rate.rate}
                    readOnly={!linesEditable}
                    onValueChange={(value) =>
                      setEdit((current) => ({
                        ...current,
                        dealtRates: [
                          ...dealtRatePairs(current, company.ledgers, pairs).filter(
                            (other) => `${other.base}/${other.quote}` !== pair,
                          ),
                          { base: rate.base, quote: rate.quote, rate: value },
                        ],
                      }))
                    }
                    onTextError={(invalid) =>
                      setRateErrors((current) => toggled(current, pair, invalid))
                    }
                  />
                  <FieldError match={refused}>{te.rateInvalid}</FieldError>
                </Field>
              );
            })}
          </div>
        </Card>
      )}

      <FailureNotice error={failure} onReload={() => onReload?.()} />
      {notice === 'saved' && !dirty && !failure && (
        <Callout role="status" tone="info" icon={<CircleCheckIcon />} title={te.saved} />
      )}

      <div className="flex flex-wrap gap-2">
        {editable && (
          <>
            <Button
              variant="outline"
              loading={save.isPending}
              disabled={busy}
              onClick={() => save.mutate()}
            >
              <SaveIcon aria-hidden="true" />
              {te.save}
              <Kbd shortcut={keymap.save} />
            </Button>
            <Button
              variant="outline"
              loading={showPreview.isPending}
              disabled={busy}
              onClick={() => showPreview.mutate()}
            >
              <EyeIcon aria-hidden="true" />
              {te.preview}
            </Button>
            {approval
              ? can(me, 'drafts.manage') && (
                  <Button loading={transition.isPending} disabled={busy} onClick={postOrSubmit}>
                    <SendIcon aria-hidden="true" />
                    {te.submit}
                    <Kbd shortcut={keymap.post} />
                  </Button>
                )
              : can(me, 'entries.post') && (
                  <Button loading={post.isPending} disabled={busy} onClick={postOrSubmit}>
                    <CheckIcon aria-hidden="true" />
                    {te.post}
                    <Kbd shortcut={keymap.post} />
                  </Button>
                )}
            {draft && (
              <Button variant="ghost" disabled={busy} onClick={() => setDialog('discard')}>
                <Trash2Icon aria-hidden="true" />
                {te.discard}
              </Button>
            )}
          </>
        )}
        {draft && state === 'submitted' && manage && (
          <Button
            variant="outline"
            loading={transition.isPending}
            disabled={busy}
            onClick={() => transition.mutate('withdraw')}
          >
            <Undo2Icon aria-hidden="true" />
            {te.withdraw}
          </Button>
        )}
        {draft && state === 'submitted' && !manage && can(me, 'drafts.read') && (
          <Button
            variant="outline"
            loading={showPreview.isPending}
            disabled={busy}
            onClick={() => showPreview.mutate()}
          >
            <EyeIcon aria-hidden="true" />
            {te.preview}
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
              {te.approve}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setDialog('reject')}>
              <XIcon aria-hidden="true" />
              {te.reject}
            </Button>
          </>
        )}
        {draft && state === 'submitted' && manage && (
          <Button
            variant="outline"
            loading={showPreview.isPending}
            disabled={busy}
            onClick={() => showPreview.mutate()}
          >
            <EyeIcon aria-hidden="true" />
            {te.preview}
          </Button>
        )}
      </div>
      {canApprove && preparerOrSubmitter && (
        <Callout tone="info" icon={<InfoIcon />} title={te.selfApproval} />
      )}

      {preview && <PreviewPanel preview={preview.answer} stale={stalePreview} />}

      {draft ? (
        <AttachmentsCard
          companyId={companyId}
          attachments={draft.attachments}
          uploadPath={editable ? `/drafts/${draft.id}/attachments` : undefined}
          removePath={
            editable
              ? (attachment) => `/drafts/${draft.id}/attachments/${attachment.id}`
              : undefined
          }
          invalidate={draftQuery(companyId, draft.id).queryKey}
        />
      ) : (
        <AttachmentsCard
          companyId={companyId}
          attachments={[]}
          invalidate={['drafts', companyId]}
          disabledNote={te.attachmentsAfterSave}
        />
      )}

      {lookup && lookupLine && (
        <Dialog open onOpenChange={(next) => !next && closeLookup()}>
          <DialogContent closeLabel={ar.common.close}>
            <DialogHeader>
              <DialogTitle>
                {lookup.column === 'account' ? te.chooseAccount : te.chooseDimension}
              </DialogTitle>
              <DialogDescription>
                {`${te.line} `}
                <bdi dir="ltr">{edit.lines.indexOf(lookupLine) + 1}</bdi>
              </DialogDescription>
            </DialogHeader>
            {lookup.column === 'account' ? (
              <AccountPicker
                label={te.account}
                accounts={pickerAccounts(accounts, { manual: true })}
                value={lookupLine.accountId}
                labels={accountPickerLabels}
                onValueChange={(id) => {
                  updateLine(lookupLine.key, (line) =>
                    withAccount(line, accountsById.get(id) ?? null),
                  );
                  closeLookup();
                }}
              />
            ) : (
              <DimensionPicker
                label={catalog.types.find((type) => `dim:${type.id}` === lookup.column)?.name ?? ''}
                values={pickerValues(catalog.valuesOf(lookup.column.slice(4)))}
                value={lineValueOf(lookupLine, lookup.column.slice(4), catalog.byId)?.id ?? null}
                labels={dimensionPickerLabels}
                onValueChange={(id) => {
                  updateLine(lookupLine.key, (line) =>
                    withDimensionValue(line, lookup.column.slice(4), id, catalog.byId),
                  );
                  closeLookup();
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      )}

      {draft && (
        <>
          <ReasonDialog
            open={dialog === 'reject'}
            onOpenChange={(next) => !next && setDialog(null)}
            title={t.reject.title}
            description={t.reject.description}
            reasonLabel={t.reject.reason}
            submitLabel={t.reject.submit}
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
            title={t.discard.title}
            description={t.discard.description}
            submitLabel={t.discard.submit}
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

/** The set with `key` in it or not. */
function toggled(set: ReadonlySet<string>, key: string, present: boolean): ReadonlySet<string> {
  if (set.has(key) === present) return set;
  const next = new Set(set);
  if (present) next.add(key);
  else next.delete(key);
  return next;
}

/** A save refused before it is sent: an amount or a rate still holds refused text. */
class RefusedText extends Error {
  override readonly name = 'RefusedText';
}

/** Why typed text is not an account the line can post to, or nothing when it is one. */
function accountProblem(code: string, byCode: ReadonlyMap<string, Account>): string | undefined {
  if (code === '') return undefined;
  const account = byCode.get(code);
  if (!account || account.archived) return te.accountUnknown;
  if (account.kind === 'header') return te.accountHeader;
  if (account.blocked) return te.accountBlocked;
  if (account.isControl) return te.accountControl;
  return undefined;
}

/** The text of a grid refusal (i18n `grid.problems`). */
function gridProblemText(problem: GridProblem): string {
  if (problem.problem !== 'INVALID_CELLS') return ar.grid.problems[problem.problem];
  const first = problem.cells[0];
  if (!first) return ar.grid.problems.nothingChanged;
  const reason =
    first.reason === 'AMOUNT'
      ? ar.accounting.amountInput[first.error]
      : first.reason === 'TEXT'
        ? first.error
        : ar.grid.problems[first.reason];
  return `${ar.grid.problems.nothingChanged} ${reason}`;
}

/** A refused write: a stale draft offers a reload, a posting refusal names its line. */
function FailureNotice({ error, onReload }: { error: unknown; onReload: () => void }) {
  if (!error || error instanceof RefusedText) {
    return error instanceof RefusedText ? (
      <Callout role="alert" tone="danger" icon={<TriangleAlertIcon />} title={te.fixBeforeSaving} />
    ) : null;
  }
  if (hasCode(error, 'DRAFT_CHANGED')) {
    return (
      <Callout
        role="alert"
        tone="warning"
        icon={<TriangleAlertIcon />}
        title={te.changed}
        action={
          <Button variant="outline" size="sm" onClick={onReload}>
            {te.reload}
          </Button>
        }
      />
    );
  }
  const refusal = refusalOfError(error);
  return refusal ? <Refusals refusals={[refusal]} /> : <FormError error={error} />;
}

/** A posting refusal from an API error, with the line it names. */
function refusalOfError(error: unknown) {
  if (!(error instanceof Object) || !('code' in error) || typeof error.code !== 'string')
    return null;
  const details = ('details' in error ? error.details : undefined) as
    | Record<string, unknown>
    | undefined;
  if (!details || error.code === 'VALIDATION_FAILED') return null;
  const lineNo = Number(details.lineNo);
  return {
    code: error.code,
    message: error.code,
    lineNo: Number.isInteger(lineNo) && lineNo > 0 ? lineNo : null,
    details: Object.fromEntries(
      Object.entries(details).map(([key, value]) => [key, String(value)]),
    ),
  };
}

/** The draft's state, its rejection and whether it is a reversal. */
function DraftBadges({ draft }: { draft: Draft }) {
  return (
    <>
      <Badge
        tone={
          draft.state === 'submitted' ? 'warning' : draft.state === 'posted' ? 'success' : 'neutral'
        }
      >
        {t.states[draft.state]}
      </Badge>
      {draft.archived && <Badge tone="neutral">{t.discarded}</Badge>}
    </>
  );
}

/** What the person must know about this draft before typing: a rejection, its state. */
function Notes({
  draft,
  reversal,
  startMonth,
}: {
  draft: Draft | null;
  reversal: boolean;
  startMonth: number;
}) {
  const { companyId } = useCompany();
  const original = useQuery({
    ...entryQuery(companyId, draft?.reversesEntryId ?? ''),
    enabled: reversal,
  });
  if (!draft) return null;
  const notes: ReactNode[] = [];
  if (draft.rejected && draft.state === 'draft') {
    notes.push(
      <Callout
        key="rejected"
        role="status"
        tone="warning"
        icon={<TriangleAlertIcon />}
        title={te.rejectedTitle}
        description={
          <span className="flex flex-col gap-1">
            <bdi>{draft.rejected.reason}</bdi>
            <span>
              {`${te.rejectedBy}: `}
              <bdi>{draft.rejected.by.name}</bdi>
              {` · ${formatDateTime(draft.rejected.at)}`}
            </span>
          </span>
        }
      />,
    );
  }
  if (draft.archived) {
    notes.push(
      <Callout key="discarded" tone="neutral" icon={<InfoIcon />} title={te.discardedNote} />,
    );
  } else if (draft.state === 'submitted') {
    notes.push(
      <Callout key="submitted" tone="info" icon={<InfoIcon />} title={te.submittedNote} />,
    );
  } else if (draft.state === 'posted' && draft.postedEntryId) {
    notes.push(
      <Callout
        key="posted"
        tone="info"
        icon={<CircleCheckIcon />}
        title={te.postedNote}
        action={
          <Button
            variant="outline"
            size="sm"
            render={<Link to="/entries/$id" params={{ id: draft.postedEntryId }} />}
          >
            {te.openEntry}
          </Button>
        }
      />,
    );
  }
  if (reversal && draft.reversesEntryId) {
    notes.push(
      <Callout
        key="reversal"
        tone="info"
        icon={<Undo2Icon />}
        title={te.reversalNote}
        description={
          original.data ? (
            <span>
              {`${te.reversalOf}: `}
              <Link
                to="/entries/$id"
                params={{ id: original.data.id }}
                className="underline underline-offset-4"
              >
                <EntryNumberText number={original.data} startMonth={startMonth} />
              </Link>
            </span>
          ) : undefined
        }
      />,
    );
  }
  return <>{notes}</>;
}

/**
 * The lines on a phone (S03 "Screens": one line per card): the account and dimension pickers,
 * the currency, debit and credit through `AmountInput`, the memo. The grid shows the same lines
 * from tablet width up.
 */
function LineCards({
  className,
  lines,
  editable,
  accounts,
  accountsById,
  dimensionTypes,
  catalog,
  bookCurrency,
  onAccount,
  onDimension,
  onCurrency,
  onSide,
  onMemo,
  onRemove,
  onAdd,
  onAmountError,
}: {
  className: string;
  lines: readonly EditLine[];
  editable: boolean;
  accounts: readonly Account[];
  accountsById: ReadonlyMap<string, Account>;
  dimensionTypes: ReturnType<typeof dimensionColumns>;
  catalog: ReturnType<typeof useDimensionCatalog>;
  bookCurrency: CurrencyCode;
  onAccount: (key: string, account: Account | null) => void;
  onDimension: (key: string, typeId: string, valueId: string | null) => void;
  onCurrency: (key: string, currency: CurrencyCode) => void;
  onSide: (key: string, side: 'debit' | 'credit', magnitude: bigint | null) => void;
  onMemo: (key: string, memo: string) => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
  onAmountError: (key: string, refused: boolean) => void;
}) {
  const options = pickerAccounts(accounts, { manual: true });
  return (
    <ol className={`flex flex-col gap-3 ${className}`} aria-label={te.lines}>
      {lines.map((line, index) => {
        const sides = debitCreditOf(line.amountMinor);
        const currency = line.currency ?? bookCurrency;
        const account = line.accountId ? accountsById.get(line.accountId) : undefined;
        const required = new Set(account?.requiredDimensionTypeIds ?? []);
        return (
          <li key={line.key}>
            <Card className="gap-3 p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">
                  {`${te.line} `}
                  <bdi dir="ltr">{index + 1}</bdi>
                </h3>
                {editable && (
                  <IconButton
                    label={`${te.removeLine} ${index + 1}`}
                    onClick={() => onRemove(line.key)}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </IconButton>
                )}
              </div>
              <AccountPicker
                label={te.account}
                accounts={options}
                value={line.accountId}
                labels={accountPickerLabels}
                disabled={!editable}
                onValueChange={(id) => onAccount(line.key, accountsById.get(id) ?? null)}
              />
              {dimensionTypes.map((type) => (
                <DimensionPicker
                  key={type.id}
                  label={type.name}
                  values={pickerValues(catalog.valuesOf(type.id))}
                  value={lineValueOf(line, type.id, catalog.byId)?.id ?? null}
                  labels={dimensionPickerLabels}
                  required={required.has(type.id)}
                  disabled={!editable}
                  onValueChange={(id) => onDimension(line.key, type.id, id)}
                />
              ))}
              <SelectField
                label={te.currency}
                value={line.currency}
                options={CURRENCY_CODES.map((code) => ({ value: code, label: code }))}
                disabled={!editable}
                onValueChange={(code) => onCurrency(line.key, code)}
              />
              <div className="grid grid-cols-2 gap-3">
                {(['debit', 'credit'] as const).map((side) => (
                  <Field key={side}>
                    <FieldLabel>{side === 'debit' ? te.debit : te.credit}</FieldLabel>
                    <AmountInput
                      currency={currency}
                      value={side === 'debit' ? sides.debitMinor : sides.creditMinor}
                      allowNegative={false}
                      disabled={!editable}
                      onValueChange={(value) => onSide(line.key, side, value)}
                      onTextError={(error) => onAmountError(`${line.key}:${side}`, error !== null)}
                    />
                  </Field>
                ))}
              </div>
              <Field>
                <FieldLabel>{te.memo}</FieldLabel>
                <Input
                  value={line.memo}
                  maxLength={300}
                  readOnly={!editable}
                  onChange={(event) => onMemo(line.key, event.target.value)}
                />
              </Field>
            </Card>
          </li>
        );
      })}
      {editable && (
        <li>
          <Button variant="outline" className="w-full" onClick={onAdd}>
            <PlusIcon aria-hidden="true" />
            {te.addLine}
          </Button>
        </li>
      )}
    </ol>
  );
}
