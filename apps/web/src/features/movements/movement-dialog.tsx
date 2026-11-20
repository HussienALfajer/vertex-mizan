import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AmountTextError,
  type CurrencyCode,
  isZeroQuantity,
  lineAmount,
  MATERIAL_MOVEMENT_KINDS,
  movementSchema,
  type Project,
  type ProjectMovementKind,
  partySchema,
  quantitySchema,
  recordMovementSchema,
  SUPPLIER_MOVEMENT_KINDS,
  ungroupTypedDecimal,
  unitPriceSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  AmountInput,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DimensionPicker,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  MaterialPicker,
  SelectField,
  SwitchField,
  Textarea,
  useTypedDecimal,
} from '@vertex-mizan/ui';
import { useState } from 'react';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { api, hasCode } from '../../lib/api';
import { damascusToday } from '../../lib/format';
import {
  inCurrency,
  MOVEMENT_CURRENCIES,
  materialsQuery,
  partiesQuery,
  projectQuery,
  projectsQuery,
  refreshBooks,
} from '../../lib/movements';
import { DayRatesDialog } from './day-rates-dialog';
import { ByCurrency } from './figures';
import { type PartyChoice, PartyField } from './party-field';

const t = ar.movements.dialog;

/** The kinds on a project, in the order the person thinks of them; a deposit is outside projects. */
const PROJECT_KINDS = [
  'received',
  'expense',
  'wages',
  'owed_by_us',
  'owed_to_us',
  'debt_paid',
  'debt_collected',
] as const satisfies readonly ProjectMovementKind[];

const isOneOf = (list: readonly string[], kind: ProjectMovementKind | null) =>
  kind !== null && list.includes(kind);

interface Form {
  kind: ProjectMovementKind | null;
  projectId: string | null;
  supplier: PartyChoice;
  date: string;
  currency: CurrencyCode;
  amount: bigint | null;
  amountError: AmountTextError | null;
  withMaterial: boolean;
  materialId: string | null;
  quantity: string;
  unitPrice: string;
  description: string;
}

type Errors = Partial<
  Record<
    | 'kind'
    | 'project'
    | 'supplier'
    | 'date'
    | 'currency'
    | 'amount'
    | 'material'
    | 'quantity'
    | 'unitPrice'
    | 'description',
    string
  >
>;

const fieldIds = {
  kind: 'movement-kind',
  project: 'movement-project',
  supplier: 'movement-supplier',
  date: 'movement-date',
  currency: 'movement-currency',
  amount: 'movement-amount',
  material: 'movement-material',
  quantity: 'movement-quantity',
  unitPrice: 'movement-unit-price',
  description: 'movement-description',
} as const;

const blank = (kind: ProjectMovementKind | null, projectId: string | null): Form => ({
  kind,
  projectId,
  supplier: { id: null },
  date: damascusToday(),
  currency: 'USD',
  amount: null,
  amountError: null,
  withMaterial: false,
  materialId: null,
  quantity: '',
  unitPrice: '',
  description: '',
});

/** A new key per movement (S13 rule 1): a repeated submit of the same form posts once. */
const newKey = () => crypto.randomUUID();

/**
 * The new movement (S13 screen 5): the kind first, then only its fields. From a project, the
 * project is fixed; from the dashboard it is picked, and a deposit has none. A refusal says what
 * to do: record the day's rates, deposit cash, or record a receipt as a debt collected.
 */
export function MovementDialog({
  companyId,
  open,
  onOpenChange,
  project,
  initialKind = null,
}: {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project the dialog opens on; without it the person picks one. */
  project?: Project | undefined;
  initialKind?: ProjectMovementKind | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={ar.common.close} className="max-w-xl">
        {open && (
          <MovementForm
            companyId={companyId}
            project={project}
            initialKind={initialKind}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MovementForm({
  companyId,
  project: fixedProject,
  initialKind,
  onDone,
}: {
  companyId: string;
  project: Project | undefined;
  initialKind: ProjectMovementKind | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(() => blank(initialKind, fixedProject?.id ?? null));
  // Quantity and unit price are grouped by thousands as they are typed, read without the commas.
  const quantityTyping = useTypedDecimal({ allowNegative: false });
  const unitPriceTyping = useTypedDecimal({ allowNegative: false });
  // The movement to come back to after a deposit made for it (S13 rule 2: deposit cash).
  const [resume, setResume] = useState<Form | null>(null);
  const [requestKey, setRequestKey] = useState(newKey);
  const [errors, setErrors] = useState<Errors>({});
  const [attempt, setAttempt] = useState(0);
  const [ratesOpen, setRatesOpen] = useState(false);

  const kind = form.kind;
  const deposit = kind === 'deposit';
  const supplierKind = isOneOf(SUPPLIER_MOVEMENT_KINDS, kind);
  const materialKind = isOneOf(MATERIAL_MOVEMENT_KINDS, kind);
  const useMaterial = materialKind && form.withMaterial;

  const projects = useQuery({
    ...projectsQuery(companyId, { state: 'active' }),
    enabled: fixedProject === undefined && !deposit,
  });
  const chosenProject = useQuery({
    ...projectQuery(companyId, form.projectId ?? ''),
    enabled: form.projectId !== null && !deposit,
    ...(fixedProject && form.projectId === fixedProject.id ? { initialData: fixedProject } : {}),
  });
  const suppliers = useQuery({ ...partiesQuery(companyId, 'supplier'), enabled: supplierKind });
  const materials = useQuery({ ...materialsQuery(companyId), enabled: materialKind });

  const project = chosenProject.data;
  const supplierId = 'id' in form.supplier ? form.supplier.id : null;
  const supplier = suppliers.data?.find((party) => party.id === supplierId);

  // Rule 4: a debt is paid or collected in a currency it is open in.
  const openAmounts =
    kind === 'debt_collected'
      ? (project?.figures.owedToUs ?? [])
      : kind === 'debt_paid'
        ? (project?.figures.owedByUs ?? [])
        : null;
  // A supplier is paid only in a currency both the project and the supplier owe in.
  const payable = (currency: CurrencyCode) =>
    kind !== 'debt_paid' || !supplier || inCurrency(supplier.owedByUs, currency) !== undefined;
  const currencies: readonly CurrencyCode[] =
    openAmounts === null
      ? MOVEMENT_CURRENCIES
      : openAmounts
          .filter((amount) => amount.amountMinor !== '0' && payable(amount.currency))
          .map((amount) => amount.currency);

  const material = materials.data?.find((option) => option.id === form.materialId);
  const quantityOk = quantitySchema.safeParse(ungroupTypedDecimal(form.quantity));
  const unitPriceOk = unitPriceSchema.safeParse(ungroupTypedDecimal(form.unitPrice));
  const computed =
    quantityOk.success && unitPriceOk.success
      ? safeLineAmount(quantityOk.data, unitPriceOk.data, form.currency)
      : null;

  const change = (patch: Partial<Form>) => setForm((old) => ({ ...old, ...patch }));

  const record = useMutation({
    mutationFn: async (current: Form) => {
      let chosenSupplier: string | null = null;
      if (isOneOf(SUPPLIER_MOVEMENT_KINDS, current.kind)) {
        if ('newName' in current.supplier) {
          const created = await api('POST', '/parties', {
            company: companyId,
            body: { type: 'supplier', name: current.supplier.newName },
            schema: partySchema,
          });
          // A retry after a refused movement uses the supplier just made, never a second one.
          change({ supplier: { id: created.id } });
          await queryClient.invalidateQueries({
            queryKey: partiesQuery(companyId, 'supplier').queryKey,
          });
          chosenSupplier = created.id;
        } else {
          chosenSupplier = current.supplier.id;
        }
      }
      const withMaterial = isOneOf(MATERIAL_MOVEMENT_KINDS, current.kind) && current.withMaterial;
      const body = recordMovementSchema.parse({
        requestKey,
        kind: current.kind,
        date: current.date,
        projectId: current.kind === 'deposit' ? null : current.projectId,
        supplierId: chosenSupplier,
        currency: current.currency,
        amountMinor: withMaterial ? null : String(current.amount),
        material: withMaterial
          ? {
              materialId: current.materialId,
              quantity: ungroupTypedDecimal(current.quantity),
              unitPrice: ungroupTypedDecimal(current.unitPrice),
            }
          : null,
        description:
          current.description.trim() === ''
            ? ar.movements.kinds[current.kind as ProjectMovementKind]
            : current.description,
        dealtRate: null,
      });
      return api('POST', '/movements', { company: companyId, body, schema: movementSchema });
    },
    onSuccess: async () => {
      await refreshBooks(queryClient, companyId);
      setRequestKey(newKey());
      if (resume) {
        setForm(resume);
        setResume(null);
        setErrors({});
        return;
      }
      onDone();
    },
  });

  function validate(): Errors {
    const found: Errors = {};
    if (kind === null) found.kind = t.required;
    if (!deposit && form.projectId === null) found.project = t.required;
    if (supplierKind) {
      if ('newName' in form.supplier) {
        const name = form.supplier.newName.trim();
        if (name === '') found.supplier = t.required;
        else if (name.length > 200) found.supplier = ar.movements.newProject.tooLong;
      } else if (form.supplier.id === null) found.supplier = t.required;
    }
    if (form.date === '') found.date = t.required;
    else if (form.date > damascusToday()) found.date = t.future;
    if (!currencies.includes(form.currency)) found.currency = t.required;
    if (useMaterial) {
      if (form.materialId === null) found.material = t.required;
      if (!quantityOk.success || isZeroQuantity(quantityOk.data))
        found.quantity = t.quantityInvalid;
      if (!unitPriceOk.success) found.unitPrice = t.unitPriceInvalid;
      else if (quantityOk.success && (computed === null || computed <= 0n))
        found.unitPrice = t.amountRequired;
    } else if (form.amountError) {
      found.amount = ar.accounting.amountInput[form.amountError];
    } else if (form.amount === null || form.amount <= 0n) {
      found.amount = t.amountRequired;
    }
    if (form.description.trim().length > 500) found.description = t.tooLong;
    return found;
  }

  const summary = (Object.keys(fieldIds) as (keyof typeof fieldIds)[]).map(
    (field) => [fieldIds[field], errors[field]] as const,
  );

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const found = validate();
        setErrors(found);
        if (Object.keys(found).length > 0) {
          setAttempt((count) => count + 1);
          return;
        }
        record.mutate(form);
      }}
    >
      <DialogHeader>
        <DialogTitle>{deposit ? ar.movements.kinds.deposit : t.title}</DialogTitle>
        <DialogDescription>{fixedProject ? fixedProject.name : t.description}</DialogDescription>
      </DialogHeader>
      <FormErrorSummary attempt={attempt} errors={summary} />

      {!deposit && (
        <SelectField
          id={fieldIds.kind}
          label={t.kind}
          value={kind}
          placeholder={t.kind}
          options={PROJECT_KINDS.map((value) => ({ value, label: ar.movements.kinds[value] }))}
          onValueChange={(next) => {
            change({ kind: next, withMaterial: false });
            record.reset();
          }}
          description={kind ? ar.movements.kindHints[kind] : undefined}
          error={errors.kind}
        />
      )}
      {deposit && (
        <p className="text-control text-muted-foreground">{ar.movements.kindHints.deposit}</p>
      )}

      {kind !== null && (
        <>
          {!deposit && fixedProject === undefined && (
            <DimensionPicker
              id={fieldIds.project}
              label={t.project}
              values={(projects.data ?? []).map((option) => ({
                id: option.id,
                name: option.name,
                detail: option.client.name,
              }))}
              value={form.projectId}
              onValueChange={(id) => change({ projectId: id })}
              labels={{ placeholder: t.projectPlaceholder, empty: t.projectEmpty }}
              error={errors.project}
            />
          )}
          {!deposit && project && isOneOf(['received', 'owed_to_us', 'debt_collected'], kind) && (
            <p className="text-control">
              <span className="text-muted-foreground">{t.client}: </span>
              {project.client.name}
            </p>
          )}

          {supplierKind && (
            <PartyField
              id={fieldIds.supplier}
              parties={suppliers.data ?? []}
              value={form.supplier}
              onValueChange={(supplierChoice) => change({ supplier: supplierChoice })}
              labels={{
                label: t.supplier,
                placeholder: t.supplierPlaceholder,
                empty: t.supplierEmpty,
                newParty: t.newSupplier,
                newPartyName: t.newSupplierName,
                pickExisting: t.pickSupplier,
              }}
              error={errors.supplier}
            />
          )}

          {openAmounts !== null && project && (
            <div className="flex flex-col gap-1 rounded-md border border-border p-3">
              <p className="text-control font-medium">
                {kind === 'debt_collected' ? t.openToUs : t.openByUs}
              </p>
              <ByCurrency
                amounts={openAmounts}
                bookCurrency={project.figures.bookCurrency}
                empty={t.noOpenDebt}
              />
              {kind === 'debt_paid' && supplier && (
                <>
                  <p className="pt-1 text-control font-medium">{t.supplierOpen}</p>
                  <ByCurrency
                    amounts={supplier.owedByUs}
                    bookCurrency={project.figures.bookCurrency}
                  />
                </>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
            <Field id={fieldIds.date} invalid={errors.date !== undefined}>
              <FieldLabel>{t.date}</FieldLabel>
              <Input
                type="date"
                dir="ltr"
                value={form.date}
                max={damascusToday()}
                onChange={(event) => change({ date: event.target.value })}
              />
              <FieldDescription>{t.dateHint}</FieldDescription>
              <FieldError match={errors.date !== undefined}>{errors.date}</FieldError>
            </Field>
            <SelectField
              id={fieldIds.currency}
              label={t.currency}
              value={currencies.includes(form.currency) ? form.currency : null}
              options={currencies.map((value) => ({
                value,
                label: ar.accounting.currencies[value],
              }))}
              onValueChange={(currency) => change({ currency })}
              error={errors.currency}
            />
          </div>

          {materialKind && (
            <SwitchField
              label={t.withMaterial}
              checked={form.withMaterial}
              onCheckedChange={(checked) => change({ withMaterial: checked })}
            />
          )}

          {useMaterial ? (
            <>
              <MaterialPicker
                id={fieldIds.material}
                label={t.material}
                materials={(materials.data ?? []).map((option) => ({
                  ...option,
                  archived: option.archivedAt !== null,
                }))}
                value={form.materialId}
                onValueChange={(chosen) => change({ materialId: chosen.id })}
                labels={{
                  placeholder: t.materialPlaceholder,
                  empty: t.materialEmpty,
                  unit: t.unit,
                  archived: t.archived,
                }}
                error={errors.material}
              />
              <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
                <Field id={fieldIds.quantity} invalid={errors.quantity !== undefined}>
                  <FieldLabel>{t.quantity}</FieldLabel>
                  <Input
                    dir="ltr"
                    inputMode="decimal"
                    ref={quantityTyping.ref}
                    value={form.quantity}
                    onChange={(event) =>
                      change({ quantity: quantityTyping.group(event.target.value, form.quantity) })
                    }
                  />
                  {material && <FieldDescription>{material.unit}</FieldDescription>}
                  <FieldError match={errors.quantity !== undefined}>{errors.quantity}</FieldError>
                </Field>
                <Field id={fieldIds.unitPrice} invalid={errors.unitPrice !== undefined}>
                  <FieldLabel>{t.unitPrice}</FieldLabel>
                  <Input
                    dir="ltr"
                    inputMode="decimal"
                    ref={unitPriceTyping.ref}
                    value={form.unitPrice}
                    onChange={(event) =>
                      change({
                        unitPrice: unitPriceTyping.group(event.target.value, form.unitPrice),
                      })
                    }
                  />
                  <FieldDescription>{ar.accounting.currencies[form.currency]}</FieldDescription>
                  <FieldError match={errors.unitPrice !== undefined}>{errors.unitPrice}</FieldError>
                </Field>
              </div>
              <p className="flex items-baseline gap-2 text-control">
                <span className="text-muted-foreground">{t.lineAmount}:</span>
                {computed === null ? (
                  '—'
                ) : (
                  <Amount value={computed} currency={form.currency} showCurrency strong />
                )}
              </p>
            </>
          ) : (
            <Field id={fieldIds.amount} invalid={errors.amount !== undefined}>
              <FieldLabel>{t.amount}</FieldLabel>
              <AmountInput
                currency={form.currency}
                value={form.amount}
                allowNegative={false}
                onValueChange={(amount) => change({ amount })}
                onTextError={(amountError) => change({ amountError })}
              />
              <FieldDescription>{ar.accounting.currencies[form.currency]}</FieldDescription>
              <FieldError match={errors.amount !== undefined}>{errors.amount}</FieldError>
            </Field>
          )}

          <Field id={fieldIds.description} invalid={errors.description !== undefined}>
            <FieldLabel>{t.note}</FieldLabel>
            <Textarea
              value={form.description}
              maxLength={500}
              rows={2}
              onChange={(event) => change({ description: event.target.value })}
            />
            <FieldDescription>{t.descriptionHint}</FieldDescription>
            <FieldError match={errors.description !== undefined}>{errors.description}</FieldError>
          </Field>
        </>
      )}

      <FormError error={record.error} />
      <Recovery
        error={record.error}
        onRates={() => setRatesOpen(true)}
        onDeposit={() => {
          setResume(form);
          setForm({ ...blank('deposit', null), currency: form.currency, date: form.date });
          setRequestKey(newKey());
          setErrors({});
          record.reset();
        }}
        onCollect={() => {
          change({ kind: 'debt_collected' });
          setRequestKey(newKey());
          record.reset();
        }}
      />

      <DialogFooter>
        {resume && (
          <Button
            variant="outline"
            onClick={() => {
              setForm(resume);
              setResume(null);
              setRequestKey(newKey());
              record.reset();
            }}
          >
            {ar.common.cancel}
          </Button>
        )}
        <Button type="submit" loading={record.isPending}>
          {t.submit}
        </Button>
      </DialogFooter>
      <DayRatesDialog
        companyId={companyId}
        date={form.date}
        open={ratesOpen}
        onOpenChange={(next) => {
          setRatesOpen(next);
          if (!next) record.reset();
        }}
      />
    </form>
  );
}

/** What a refusal asks the person to do next (S13 rule 2 and rule 7). */
function Recovery({
  error,
  onRates,
  onDeposit,
  onCollect,
}: {
  error: unknown;
  onRates: () => void;
  onDeposit: () => void;
  onCollect: () => void;
}) {
  const action = hasCode(error, 'RATE_MISSING')
    ? { label: t.toRates, run: onRates }
    : hasCode(error, 'CASH_BOX_NEGATIVE')
      ? { label: t.toDeposit, run: onDeposit }
      : hasCode(error, 'CLIENT_HAS_OPEN_DEBT')
        ? { label: t.toCollect, run: onCollect }
        : null;
  if (!action) return null;
  return (
    <Button variant="outline" className="w-fit" onClick={action.run}>
      {action.label}
    </Button>
  );
}

function safeLineAmount(quantity: string, unitPrice: string, currency: CurrencyCode) {
  try {
    return lineAmount(quantity, unitPrice, currency).amountMinor;
  } catch {
    return null;
  }
}
