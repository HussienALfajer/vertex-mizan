import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import {
  type Account,
  CURRENCY_CODES,
  type CurrencyCode,
  createSubcontractSchema,
  money,
  type ProjectTermsView,
  projectTermsInputSchema,
  projectTermsViewSchema,
  type Subcontract,
  subcontractSchema,
  summarizeAmounts,
  updateSubcontractSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountPicker,
  Amount,
  AmountInput,
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
  DimensionPicker,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  PageHeader,
  SelectField,
  Skeleton,
  SwitchField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import {
  CircleCheckIcon,
  FileBarChartIcon,
  InfoIcon,
  LockIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState } from 'react';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { api } from '../../lib/api';
import { can, useCompany } from '../../lib/session';
import { accountsQuery } from '../chart/chart-queries';
import {
  accountPickerLabels,
  dimensionPickerLabels,
  pickerAccounts,
  pickerValues,
} from '../entries/entry-parts';
import {
  basisPointsOf,
  basisPointsText,
  ProjectsBackLink,
  useProjectCatalog,
} from './project-parts';
import { projectTermsQuery, subcontractsQuery } from './project-queries';

const t = ar.projects.terms;
const route = getRouteApi('/_app/_company/projects/$valueId/terms');

const currencyOptions = CURRENCY_CODES.map((code) => ({
  value: code,
  label: `${code} · ${ar.accounting.currencies[code]}`,
}));

/** The postable direct-cost accounts a budget names (S12 "Data"). */
const directCostAccounts = (accounts: readonly Account[]) =>
  accounts.filter(
    (account) =>
      account.kind === 'postable' &&
      account.statementLine === 'is.direct_costs' &&
      !account.archived,
  );

/**
 * `/projects/:valueId/terms` (S12 "Screens", rules 1–2): the project's contract currency and value,
 * its retention and recovery rates, the budget per direct-cost account, and its subcontracts. The
 * owner and the accountant edit; the currency is shown locked after the first posted billing.
 */
export function ProjectTermsPage() {
  const { valueId } = route.useParams();
  const { companyId, me, membership } = useCompany();
  const manage = !membership.company.archived && can(me, 'dimensions.manage');
  const view = useQuery(projectTermsQuery(companyId, valueId));
  const accounts = useQuery(accountsQuery(companyId));
  if (view.isPending || accounts.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (view.isError || accounts.isError) {
    return (
      <>
        <ProjectsBackLink />
        <FormError error={view.error ?? accounts.error} />
      </>
    );
  }
  return (
    <>
      <PageHeader
        back={<ProjectsBackLink />}
        title={
          <span>
            {`${t.title}: `}
            <bdi>{view.data.name}</bdi>
          </span>
        }
        description={t.description}
        actions={
          <Button variant="outline" render={<Link to="/projects/$valueId" params={{ valueId }} />}>
            <FileBarChartIcon aria-hidden="true" />
            {t.report}
          </Button>
        }
      />
      {!manage && <Callout tone="info" icon={<InfoIcon />} title={t.readOnly} />}
      <TermsForm
        key={view.data.terms?.updatedAt ?? 'new'}
        view={view.data}
        accounts={directCostAccounts(accounts.data)}
        manage={manage}
      />
      <Subcontracts valueId={valueId} manage={manage} />
    </>
  );
}

interface BudgetRow {
  readonly key: number;
  readonly accountId: string | null;
  readonly amountMinor: bigint | null;
}

interface TermsErrors {
  currency?: string;
  contractValue?: string;
  retention?: string;
  recovery?: string;
  budget?: string;
}

let lastBudgetKey = 0;
const budgetKey = () => {
  lastBudgetKey += 1;
  return lastBudgetKey;
};

function TermsForm({
  view,
  accounts,
  manage,
}: {
  view: ProjectTermsView;
  accounts: readonly Account[];
  manage: boolean;
}) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const { terms } = view;
  const [currency, setCurrency] = useState<CurrencyCode | null>(terms?.currency ?? null);
  const [contractValue, setContractValue] = useState<bigint | null>(
    terms ? BigInt(terms.contractValueMinor) : null,
  );
  const [retention, setRetention] = useState(terms ? basisPointsText(terms.retentionBp) : '');
  const [recovery, setRecovery] = useState(terms ? basisPointsText(terms.advanceRecoveryBp) : '');
  const [budget, setBudget] = useState<readonly BudgetRow[]>(
    (terms?.budget ?? []).map((line) => ({
      key: budgetKey(),
      accountId: line.accountId,
      amountMinor: BigInt(line.amountMinor),
    })),
  );
  const [refused, setRefused] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<TermsErrors>({});
  const [attempt, setAttempt] = useState(0);
  const [saved, setSaved] = useState(false);
  const shownCurrency = currency ?? 'USD';
  const save = useMutation({
    mutationFn: (body: unknown) =>
      api('PUT', `/projects/${view.contractValueId}/terms`, {
        company: companyId,
        body,
        schema: projectTermsViewSchema,
      }),
    onSuccess: async (next) => {
      queryClient.setQueryData(projectTermsQuery(companyId, view.contractValueId).queryKey, next);
      await queryClient.invalidateQueries({ queryKey: ['reports', companyId] });
      setSaved(true);
    },
  });
  const refuse = (key: string, error: boolean) =>
    setRefused((current) => {
      const next = new Set(current);
      if (error) next.add(key);
      else next.delete(key);
      return next;
    });
  const total =
    currency === null
      ? null
      : (summarizeAmounts(
          budget.flatMap((row) =>
            row.amountMinor === null ? [] : [money(row.amountMinor, currency)],
          ),
        ).find((sum) => sum.currency === currency)?.sumMinor ?? 0n);

  function submit() {
    const found: TermsErrors = {};
    if (currency === null) found.currency = ar.projects.form.currencyMissing;
    if (contractValue === null || refused.has('value'))
      found.contractValue = ar.projects.form.amountMissing;
    const retentionBp = basisPointsOf(retention);
    const recoveryBp = basisPointsOf(recovery);
    if (retentionBp === null) found.retention = t.rateInvalid;
    if (recoveryBp === null) found.recovery = t.rateInvalid;
    const lines = budget.filter((row) => row.accountId !== null || row.amountMinor !== null);
    if (lines.some((row) => row.accountId === null)) found.budget = t.budgetAccountMissing;
    else if (new Set(lines.map((row) => row.accountId)).size !== lines.length) {
      found.budget = t.budgetAccountTwice;
    } else if (lines.some((row) => row.amountMinor === null || refused.has(`budget:${row.key}`))) {
      found.budget = ar.projects.form.amountMissing;
    }
    setErrors(found);
    setSaved(false);
    if (Object.keys(found).length > 0) {
      setAttempt((count) => count + 1);
      return;
    }
    save.mutate(
      projectTermsInputSchema.parse({
        currency,
        contractValueMinor: String(contractValue),
        retentionBp,
        advanceRecoveryBp: recoveryBp,
        budget: lines.map((row) => ({
          accountId: row.accountId,
          amountMinor: String(row.amountMinor),
        })),
      }),
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>
          {view.clientValueId && (
            <span>
              {`${t.client}: `}
              <ClientName id={view.clientValueId} />
            </span>
          )}
          {!terms && <span className="block">{t.notSet}</span>}
        </CardDescription>
      </CardHeader>
      <form
        noValidate
        className="flex min-w-0 flex-col gap-6 px-6 pb-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <FormErrorSummary
          attempt={attempt}
          errors={[
            ['terms-currency', errors.currency],
            ['terms-value', errors.contractValue],
            ['terms-retention', errors.retention],
            ['terms-recovery', errors.recovery],
            ['terms-budget', errors.budget],
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="terms-currency"
            label={t.currency}
            value={currency}
            options={currencyOptions}
            placeholder={ar.chart.sheet.choose}
            disabled={!manage || terms?.currencyLocked === true}
            description={terms?.currencyLocked ? t.currencyLocked : undefined}
            error={errors.currency}
            onValueChange={(value) => setCurrency(value as CurrencyCode)}
          />
          <Field id="terms-value" invalid={errors.contractValue !== undefined}>
            <FieldLabel>{t.contractValue}</FieldLabel>
            <AmountInput
              currency={shownCurrency}
              value={contractValue}
              allowNegative={false}
              readOnly={!manage}
              onValueChange={setContractValue}
              onTextError={(error) => refuse('value', error !== null)}
            />
            <FieldError match={errors.contractValue !== undefined}>
              {errors.contractValue}
            </FieldError>
          </Field>
          <Field id="terms-retention" invalid={errors.retention !== undefined}>
            <FieldLabel>{t.retentionRate}</FieldLabel>
            <Input
              dir="ltr"
              inputMode="decimal"
              value={retention}
              readOnly={!manage}
              onChange={(event) => setRetention(event.target.value)}
            />
            <FieldDescription>{t.rateHint}</FieldDescription>
            <FieldError match={errors.retention !== undefined}>{errors.retention}</FieldError>
          </Field>
          <Field id="terms-recovery" invalid={errors.recovery !== undefined}>
            <FieldLabel>{t.recoveryRate}</FieldLabel>
            <Input
              dir="ltr"
              inputMode="decimal"
              value={recovery}
              readOnly={!manage}
              onChange={(event) => setRecovery(event.target.value)}
            />
            <FieldDescription>{t.rateHint}</FieldDescription>
            <FieldError match={errors.recovery !== undefined}>{errors.recovery}</FieldError>
          </Field>
        </div>
        <fieldset id="terms-budget" className="flex min-w-0 flex-col gap-3">
          <legend className="mb-1 font-medium">{t.budget}</legend>
          <p className="text-control text-muted-foreground">{t.budgetDescription}</p>
          {budget.length === 0 ? (
            <p className="text-control text-muted-foreground">{t.budgetEmpty}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {budget.map((row, index) => (
                <li
                  key={row.key}
                  className="grid items-end gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
                >
                  <AccountPicker
                    label={`${t.budgetAccount} ${index + 1}`}
                    accounts={pickerAccounts(accounts)}
                    value={row.accountId}
                    labels={accountPickerLabels}
                    disabled={!manage}
                    onValueChange={(accountId) =>
                      setBudget((rows) =>
                        rows.map((other) =>
                          other.key === row.key ? { ...other, accountId } : other,
                        ),
                      )
                    }
                  />
                  <Field>
                    <FieldLabel>{`${t.budgetAmount} ${index + 1}`}</FieldLabel>
                    <AmountInput
                      currency={shownCurrency}
                      value={row.amountMinor}
                      allowNegative={false}
                      readOnly={!manage}
                      onValueChange={(amountMinor) =>
                        setBudget((rows) =>
                          rows.map((other) =>
                            other.key === row.key ? { ...other, amountMinor } : other,
                          ),
                        )
                      }
                      onTextError={(error) => refuse(`budget:${row.key}`, error !== null)}
                    />
                  </Field>
                  {manage && (
                    <IconButton
                      label={`${t.removeBudget} ${index + 1}`}
                      variant="ghost"
                      onClick={() =>
                        setBudget((rows) => rows.filter((other) => other.key !== row.key))
                      }
                    >
                      <Trash2Icon />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          )}
          <FieldError match={errors.budget !== undefined}>{errors.budget}</FieldError>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {manage && (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setBudget((rows) => [
                    ...rows,
                    { key: budgetKey(), accountId: null, amountMinor: null },
                  ])
                }
              >
                <PlusIcon aria-hidden="true" />
                {t.addBudget}
              </Button>
            )}
            {currency !== null && total !== null && (
              <p className="ms-auto flex items-baseline gap-2 text-control">
                <span className="text-muted-foreground">{t.budgetTotal}</span>
                <Amount value={total} currency={currency} showCurrency strong />
              </p>
            )}
          </div>
        </fieldset>
        <FormError error={save.error} />
        {saved && (
          <p role="status" className="flex items-center gap-2 text-control">
            <CircleCheckIcon aria-hidden="true" className="size-icon text-primary" />
            {t.saved}
          </p>
        )}
        {manage && (
          <Button type="submit" className="w-fit" loading={save.isPending}>
            {t.save}
          </Button>
        )}
      </form>
    </Card>
  );
}

function ClientName({ id }: { id: string }) {
  const { companyId } = useCompany();
  const { nameOf } = useProjectCatalog(companyId);
  return <bdi>{nameOf(id) ?? ''}</bdi>;
}

type SubcontractDialog = { kind: 'create' } | { kind: 'edit'; subcontract: Subcontract };

/** The project's subcontracts (rule 2): each supplier with its currency, value and rates. */
function Subcontracts({ valueId, manage }: { valueId: string; manage: boolean }) {
  const { companyId } = useCompany();
  const list = useQuery(subcontractsQuery(companyId, { contract: valueId }));
  const { nameOf } = useProjectCatalog(companyId);
  const [dialog, setDialog] = useState<SubcontractDialog | null>(null);
  const s = t.subcontracts;
  const rows = list.data?.subcontracts ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{s.title}</CardTitle>
          <CardDescription>{s.description}</CardDescription>
        </div>
        {manage && (
          <Button variant="outline" onClick={() => setDialog({ kind: 'create' })}>
            <PlusIcon aria-hidden="true" />
            {s.add}
          </Button>
        )}
      </CardHeader>
      <div className="min-w-0 px-6 pb-6">
        {list.isPending ? (
          <Skeleton className="h-row" />
        ) : list.isError ? (
          <FormError error={list.error} />
        ) : rows.length === 0 ? (
          <EmptyState title={s.empty} />
        ) : (
          <Table aria-label={s.title}>
            <TableHeader>
              <TableRow>
                <TableHead>{s.supplier}</TableHead>
                <TableHead>{s.currency}</TableHead>
                <TableHead numeric>{s.value}</TableHead>
                <TableHead numeric>{s.retention}</TableHead>
                <TableHead numeric>{s.recovery}</TableHead>
                <TableHead>{s.state}</TableHead>
                {manage && (
                  <TableHead>
                    <span className="sr-only">{s.edit}</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((subcontract) => (
                <TableRow key={subcontract.id}>
                  <TableCell>
                    <bdi>{nameOf(subcontract.supplierValueId) ?? ''}</bdi>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1">
                      <bdi dir="ltr">{subcontract.currency}</bdi>
                      {subcontract.currencyLocked && (
                        <LockIcon
                          role="img"
                          aria-label={t.currencyLocked}
                          className="size-icon text-muted-foreground"
                        />
                      )}
                    </span>
                  </TableCell>
                  <TableCell numeric>
                    {subcontract.valueMinor === null ? (
                      <span className="text-muted-foreground">{s.valueNone}</span>
                    ) : (
                      <Amount
                        value={BigInt(subcontract.valueMinor)}
                        currency={subcontract.currency}
                      />
                    )}
                  </TableCell>
                  <TableCell numeric>
                    <bdi dir="ltr">{`${basisPointsText(subcontract.retentionBp)}%`}</bdi>
                  </TableCell>
                  <TableCell numeric>
                    <bdi dir="ltr">{`${basisPointsText(subcontract.advanceRecoveryBp)}%`}</bdi>
                  </TableCell>
                  <TableCell>
                    <Badge tone={subcontract.archivedAt ? 'neutral' : 'success'}>
                      {subcontract.archivedAt ? s.archived : s.active}
                    </Badge>
                  </TableCell>
                  {manage && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${s.edit}: ${nameOf(subcontract.supplierValueId) ?? ''}`}
                        onClick={() => setDialog({ kind: 'edit', subcontract })}
                      >
                        {s.edit}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {dialog && (
        <SubcontractFormDialog valueId={valueId} mode={dialog} onClose={() => setDialog(null)} />
      )}
    </Card>
  );
}

/** A new subcontract of the project, or an existing one's currency, value, rates and state. */
function SubcontractFormDialog({
  valueId,
  mode,
  onClose,
}: {
  valueId: string;
  mode: SubcontractDialog;
  onClose: () => void;
}) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const { counterparties } = useProjectCatalog(companyId);
  const s = t.subcontracts;
  const current = mode.kind === 'edit' ? mode.subcontract : null;
  const [supplier, setSupplier] = useState<string | null>(current?.supplierValueId ?? null);
  const [currency, setCurrency] = useState<CurrencyCode | null>(current?.currency ?? null);
  const [value, setValue] = useState<bigint | null>(
    current?.valueMinor ? BigInt(current.valueMinor) : null,
  );
  const [valueRefused, setValueRefused] = useState(false);
  const [retention, setRetention] = useState(current ? basisPointsText(current.retentionBp) : '');
  const [recovery, setRecovery] = useState(
    current ? basisPointsText(current.advanceRecoveryBp) : '',
  );
  const [archived, setArchived] = useState(current?.archivedAt != null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [attempt, setAttempt] = useState(0);
  const save = useMutation({
    mutationFn: (body: unknown) =>
      current
        ? api('PATCH', `/subcontracts/${current.id}`, {
            company: companyId,
            body,
            schema: subcontractSchema,
          })
        : api('POST', '/subcontracts', { company: companyId, body, schema: subcontractSchema }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects', companyId] });
      onClose();
    },
  });

  function submit() {
    const found: Record<string, string | undefined> = {};
    if (supplier === null) found.supplier = s.supplierMissing;
    if (currency === null) found.currency = ar.projects.form.currencyMissing;
    if (valueRefused) found.value = ar.projects.form.amountMissing;
    const retentionBp = basisPointsOf(retention);
    const recoveryBp = basisPointsOf(recovery);
    if (retentionBp === null) found.retention = t.rateInvalid;
    if (recoveryBp === null) found.recovery = t.rateInvalid;
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      setAttempt((count) => count + 1);
      return;
    }
    const valueMinor = value === null ? null : String(value);
    if (!current) {
      save.mutate(
        createSubcontractSchema.parse({
          contractValueId: valueId,
          supplierValueId: supplier,
          currency,
          valueMinor,
          retentionBp,
          advanceRecoveryBp: recoveryBp,
        }),
      );
      return;
    }
    const change: Record<string, unknown> = {};
    if (currency !== current.currency) change.currency = currency;
    if (valueMinor !== current.valueMinor) change.valueMinor = valueMinor;
    if (retentionBp !== current.retentionBp) change.retentionBp = retentionBp;
    if (recoveryBp !== current.advanceRecoveryBp) change.advanceRecoveryBp = recoveryBp;
    if (archived !== (current.archivedAt !== null)) change.archived = archived;
    if (Object.keys(change).length === 0) {
      onClose();
      return;
    }
    save.mutate(updateSubcontractSchema.parse(change));
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
            <DialogTitle>{current ? s.editTitle : s.newTitle}</DialogTitle>
            <DialogDescription>{s.dialogDescription}</DialogDescription>
          </DialogHeader>
          <FormErrorSummary
            attempt={attempt}
            errors={[
              ['subcontract-supplier', errors.supplier],
              ['subcontract-currency', errors.currency],
              ['subcontract-value', errors.value],
              ['subcontract-retention', errors.retention],
              ['subcontract-recovery', errors.recovery],
            ]}
          />
          <DimensionPicker
            id="subcontract-supplier"
            label={s.supplier}
            values={pickerValues(counterparties('supplier'))}
            value={supplier}
            onValueChange={setSupplier}
            labels={dimensionPickerLabels}
            required
            disabled={current !== null}
            error={errors.supplier}
          />
          <SelectField
            id="subcontract-currency"
            label={s.currency}
            value={currency}
            options={currencyOptions}
            placeholder={ar.chart.sheet.choose}
            disabled={current?.currencyLocked === true}
            description={current?.currencyLocked ? t.currencyLocked : undefined}
            error={errors.currency}
            onValueChange={(next) => setCurrency(next as CurrencyCode)}
          />
          <Field id="subcontract-value" invalid={errors.value !== undefined}>
            <FieldLabel>{s.value}</FieldLabel>
            <AmountInput
              currency={currency ?? 'USD'}
              value={value}
              allowNegative={false}
              onValueChange={setValue}
              onTextError={(error) => setValueRefused(error !== null)}
            />
            <FieldError match={errors.value !== undefined}>{errors.value}</FieldError>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="subcontract-retention" invalid={errors.retention !== undefined}>
              <FieldLabel>{t.retentionRate}</FieldLabel>
              <Input
                dir="ltr"
                inputMode="decimal"
                value={retention}
                onChange={(event) => setRetention(event.target.value)}
              />
              <FieldError match={errors.retention !== undefined}>{errors.retention}</FieldError>
            </Field>
            <Field id="subcontract-recovery" invalid={errors.recovery !== undefined}>
              <FieldLabel>{t.recoveryRate}</FieldLabel>
              <Input
                dir="ltr"
                inputMode="decimal"
                value={recovery}
                onChange={(event) => setRecovery(event.target.value)}
              />
              <FieldError match={errors.recovery !== undefined}>{errors.recovery}</FieldError>
            </Field>
          </div>
          {current && (
            <SwitchField label={s.archive} checked={archived} onCheckedChange={setArchived} />
          )}
          <FormError error={save.error} />
          <DialogFooter>
            <Button type="submit" loading={save.isPending}>
              {s.submit}
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
