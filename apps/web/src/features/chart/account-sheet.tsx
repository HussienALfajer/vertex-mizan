import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type Account,
  type AccountClass,
  type AccountKind,
  type AccountLevel,
  accountClassOfCode,
  accountCodeLevel,
  accountSchema,
  CASH_KINDS,
  type CashKind,
  COUNTERPARTY_TYPES,
  type CounterpartyType,
  CURRENCY_CODES,
  type CurrencyCode,
  canBeCashAccount,
  checkAccountCode,
  createAccountSchema,
  defaultNormalBalance,
  ITEM_KINDS,
  type ItemKind,
  NORMAL_BALANCES,
  type NormalBalance,
  STATEMENT_LINES,
  statementLineFits,
  type UpdateAccount,
  updateAccountSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  Badge,
  Button,
  Callout,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  SelectField,
  SheetClose,
  SheetContent,
  SheetTitle,
  SwitchField,
} from '@vertex-mizan/ui';
import { InfoIcon, LockIcon } from 'lucide-react';
import { useState } from 'react';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { api } from '../../lib/api';
import { useCompany } from '../../lib/session';
import { dimensionTypesQuery } from '../dimensions/dimension-queries';

const t = ar.chart;
const s = t.sheet;

/** What the sheet shows: a new account under a header, or an existing account. */
export type AccountSheetMode =
  | { kind: 'create'; parent: Account }
  | { kind: 'edit'; account: Account };

interface AccountForm {
  parentId: string;
  code: string;
  kind: AccountKind;
  name: string;
  nameLatin: string;
  /** Null: the class's default, which follows the class as the parent or code changes (rule 2). */
  normalBalance: NormalBalance | null;
  statementLine: string | null;
  currency: CurrencyCode | null;
  isControl: boolean;
  /** A control account's item kind (S04), asked for when "control" is ticked. */
  itemKind: ItemKind | null;
  /** A control account's counterparty type (S11 rule 5), asked for when "control" is ticked. */
  counterpartyType: CounterpartyType | null;
  /** A cash account's kind (S11 rule 7), offered on an account that can carry it. */
  cashKind: CashKind | null;
  isMonetary: boolean;
  /** Every line names a material and a quantity (S12 rule 4): a postable expense only. */
  requiresMaterial: boolean;
  requiredDimensionTypeIds: string[];
}

/**
 * The next free code under a header (ADR 0011): one more digit at levels 2 and 3, three more at
 * level 4; null when the parent's codes are all taken.
 */
export function nextChildCode(parent: Account, accounts: readonly Account[]): string | null {
  const taken = new Set(accounts.map((account) => account.code));
  const [from, to, width] = parent.level === 3 ? [1, 999, 3] : [1, 9, 1];
  for (let next = from; next <= to; next += 1) {
    const code = `${parent.code}${String(next).padStart(width, '0')}`;
    if (!taken.has(code)) return code;
  }
  return null;
}

function formOf(mode: AccountSheetMode, accounts: readonly Account[]): AccountForm {
  if (mode.kind === 'create') {
    return {
      parentId: mode.parent.id,
      code: nextChildCode(mode.parent, accounts) ?? mode.parent.code,
      kind: defaultKind(mode.parent.level + 1),
      name: '',
      nameLatin: '',
      normalBalance: null,
      statementLine: null,
      currency: null,
      isControl: false,
      itemKind: null,
      counterpartyType: null,
      cashKind: null,
      isMonetary: false,
      requiresMaterial: false,
      requiredDimensionTypeIds: [],
    };
  }
  const { account } = mode;
  return {
    parentId: account.parentId ?? '',
    code: account.code,
    kind: account.kind,
    name: account.name,
    nameLatin: account.nameLatin ?? '',
    // A contra account keeps its chosen balance; any other follows its class.
    normalBalance:
      account.normalBalance === defaultNormalBalance(account.class) ? null : account.normalBalance,
    statementLine: account.statementLine,
    currency: account.currency,
    isControl: account.isControl,
    itemKind: account.itemKind,
    counterpartyType: account.counterpartyType,
    cashKind: account.cashKind,
    isMonetary: account.isMonetary,
    requiresMaterial: account.requiresMaterial,
    requiredDimensionTypeIds: account.requiredDimensionTypeIds,
  };
}

/** A new account's kind at a level: headers at levels 1 and 2 (check 2), postable below. */
function defaultKind(level: number): AccountKind {
  return level <= 2 ? 'header' : 'postable';
}

/** The kind a level allows, or null when both are allowed (level 3). */
function fixedKind(level: number): AccountKind | null {
  return level <= 2 ? 'header' : level === 4 ? 'postable' : null;
}

/** The form as sent: the kind the level allows and the normal balance resolved by class. */
type ResolvedForm = Omit<AccountForm, 'normalBalance'> & { normalBalance: NormalBalance };

function classOf(code: string, fallback: AccountClass): AccountClass {
  return accountCodeLevel(code) === null ? fallback : accountClassOfCode(code);
}

/** Whether the form's account can carry a cash kind (S11 "Data"). */
function cashKindFits(form: ResolvedForm, accountClass: AccountClass): boolean {
  const postable = form.kind === 'postable';
  const flags = postable && (accountClass === 'asset' || accountClass === 'liability');
  return canBeCashAccount({
    code: form.code,
    kind: form.kind,
    class: accountClass,
    currency: postable ? form.currency : null,
    isMonetary: flags && form.isMonetary,
    isControl: flags && form.isControl,
    statementLine: postable ? form.statementLine : null,
  });
}

/** Whether the form's account can require a material: a postable expense (S12 "Data"). */
function requiresMaterialFits(form: ResolvedForm, accountClass: AccountClass): boolean {
  return form.kind === 'postable' && accountClass === 'expense';
}

/** The fields a postable account sends, emptied on a header (S02 check 4). */
function shaped(form: ResolvedForm, accountClass: AccountClass) {
  const postable = form.kind === 'postable';
  const flags = postable && (accountClass === 'asset' || accountClass === 'liability');
  return {
    statementLine: postable ? form.statementLine : null,
    currency: postable ? form.currency : null,
    isControl: flags && form.isControl,
    itemKind: flags && form.isControl ? form.itemKind : null,
    counterpartyType: flags && form.isControl ? form.counterpartyType : null,
    cashKind: cashKindFits(form, accountClass) ? form.cashKind : null,
    isMonetary: flags && form.isMonetary,
    requiresMaterial: requiresMaterialFits(form, accountClass) && form.requiresMaterial,
    requiredDimensionTypeIds: postable ? form.requiredDimensionTypeIds : [],
  };
}

/** The changed fields of an edit, nothing else: a locked account refuses even an unchanged one. */
function changes(account: Account, form: ResolvedForm, accountClass: AccountClass): UpdateAccount {
  const next = { ...form, ...shaped(form, accountClass), nameLatin: form.nameLatin.trim() || null };
  const change: Record<string, unknown> = {};
  if (next.parentId !== (account.parentId ?? '')) change.parentId = next.parentId;
  if (next.code !== account.code) change.code = next.code;
  if (next.kind !== account.kind) change.kind = next.kind;
  if (next.name !== account.name) change.name = next.name;
  if (next.nameLatin !== account.nameLatin) change.nameLatin = next.nameLatin;
  if (next.normalBalance !== account.normalBalance) change.normalBalance = next.normalBalance;
  if (next.statementLine !== account.statementLine) change.statementLine = next.statementLine;
  if (next.currency !== account.currency) change.currency = next.currency;
  if (next.isControl !== account.isControl) change.isControl = next.isControl;
  if (next.itemKind !== account.itemKind) change.itemKind = next.itemKind;
  if (next.counterpartyType !== account.counterpartyType) {
    change.counterpartyType = next.counterpartyType;
  }
  if (next.cashKind !== account.cashKind) change.cashKind = next.cashKind;
  if (next.isMonetary !== account.isMonetary) change.isMonetary = next.isMonetary;
  if (next.requiresMaterial !== account.requiresMaterial) {
    change.requiresMaterial = next.requiresMaterial;
  }
  const before = [...account.requiredDimensionTypeIds].sort().join();
  if ([...next.requiredDimensionTypeIds].sort().join() !== before) {
    change.requiredDimensionTypeIds = next.requiredDimensionTypeIds;
  }
  return change as UpdateAccount;
}

const kindOptions = (['header', 'postable'] as const).map((kind) => ({
  value: kind,
  label: t.kinds[kind],
}));
const balanceOptions = NORMAL_BALANCES.map((balance) => ({
  value: balance,
  label: t.normalBalances[balance],
}));
const itemKindOptions = ITEM_KINDS.map((kind) => ({ value: kind, label: t.itemKinds[kind] }));
const counterpartyTypeOptions = COUNTERPARTY_TYPES.map((type) => ({
  value: type,
  label: t.counterpartyTypes[type],
}));
const noCashKind = 'none';
const cashKindOptions = [
  { value: noCashKind, label: s.cashKindNone },
  ...CASH_KINDS.map((kind) => ({ value: kind, label: t.cashKinds[kind] })),
];
const noCurrency = 'none';
const currencyOptions = [
  { value: noCurrency, label: s.anyCurrency },
  ...CURRENCY_CODES.map((code) => ({
    value: code,
    label: `${ar.accounting.currencies[code]} (${code})`,
  })),
];

/**
 * An account in a side sheet (S02 rules 2–4): a new account under a header, or an existing one to
 * edit (or read, without `accounts.manage`). Once used, the locked fields are shown disabled with a
 * notice of what stays editable; a header with children keeps its place the same way.
 */
export function AccountSheet({
  mode,
  accounts,
  manage,
  onDone,
}: {
  mode: AccountSheetMode;
  accounts: readonly Account[];
  manage: boolean;
  onDone: () => void;
}) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const types = useQuery(dimensionTypesQuery(companyId));
  const [form, setForm] = useState(() => formOf(mode, accounts));
  const [errors, setErrors] = useState<{
    code?: string;
    name?: string;
    line?: string;
    itemKind?: string;
    counterpartyType?: string;
  }>({});
  const [attempt, setAttempt] = useState(0);
  const [unchanged, setUnchanged] = useState(false);
  const account = mode.kind === 'edit' ? mode.account : undefined;
  const parent = accounts.find((candidate) => candidate.id === form.parentId);
  const accountClass = classOf(form.code, parent?.class ?? account?.class ?? 'asset');
  const used = account?.firstPostedAt != null;
  const hasChildren = account
    ? accounts.some((candidate) => candidate.parentId === account.id)
    : false;
  const isRoot = account?.level === 1;
  const level = isRoot ? 1 : (parent?.level ?? 0) + 1;
  const kindFixed = fixedKind(level);
  const resolved: ResolvedForm = {
    ...form,
    kind: kindFixed ?? form.kind,
    normalBalance: form.normalBalance ?? defaultNormalBalance(accountClass),
  };
  const readOnly = !manage || account?.archived != null;
  // S02 check 5: the place, kind and class of a used account, or a header with children, stay.
  const placeLocked = readOnly || used || hasChildren || isRoot;
  const set = <K extends keyof AccountForm>(key: K, value: AccountForm[K]) => {
    setUnchanged(false);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = useMutation({
    mutationFn: (body: unknown) =>
      account
        ? api('PATCH', `/accounts/${account.id}`, {
            company: companyId,
            body: updateAccountSchema.parse(body),
            schema: accountSchema,
          })
        : api('POST', '/accounts', {
            company: companyId,
            body: createAccountSchema.parse(body),
            schema: accountSchema,
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['chart', companyId] });
      onDone();
    },
  });

  function submit() {
    const found: typeof errors = {};
    if (form.name.trim() === '') found.name = t.validation.required;
    else if (form.name.trim().length > 200 || form.nameLatin.trim().length > 200) {
      found.name = t.validation.nameLength;
    }
    if (!placeLocked && parent) {
      try {
        checkAccountCode(form.code, { ...parent, level: parent.level as AccountLevel });
      } catch {
        found.code = ar.errors.ACCOUNT_CODE_INVALID;
      }
    }
    if (resolved.kind === 'postable' && !form.statementLine)
      found.line = t.validation.statementLine;
    if (shaped(resolved, accountClass).isControl && form.itemKind === null) {
      found.itemKind = t.validation.itemKind;
    }
    if (shaped(resolved, accountClass).isControl && form.counterpartyType === null) {
      found.counterpartyType = t.validation.counterpartyType;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setAttempt((count) => count + 1);
      return;
    }
    if (account) {
      const change = changes(account, resolved, accountClass);
      if (Object.keys(change).length === 0) {
        setUnchanged(true);
        return;
      }
      save.mutate(change);
      return;
    }
    save.mutate({
      parentId: form.parentId,
      code: form.code,
      kind: resolved.kind,
      name: form.name,
      nameLatin: form.nameLatin.trim() || null,
      normalBalance: resolved.normalBalance,
      ...shaped(resolved, accountClass),
    });
  }

  const parents = accounts.filter(
    (candidate) =>
      candidate.kind === 'header' &&
      candidate.level < 4 &&
      candidate.archived === null &&
      candidate.id !== account?.id,
  );
  // In presentation order: a line appended to the catalogue is placed by its `order`.
  const lines = STATEMENT_LINES.filter((line) => statementLineFits(line.code, accountClass)).sort(
    (a, b) => a.order - b.order,
  );
  const flagsFit = accountClass === 'asset' || accountClass === 'liability';
  /** A built-in dimension type's id by code. */
  const typeIdOf = (code: string) =>
    types.data?.find((type) => type.builtin && type.code === code)?.id;
  // The counterparty's dimension stays required while the account is a control account (rule 5).
  const counterpartyTypeId =
    shaped(resolved, accountClass).isControl && form.counterpartyType !== null
      ? typeIdOf(form.counterpartyType)
      : undefined;
  const title = !account ? s.createTitle : readOnly ? s.viewTitle : s.editTitle;

  return (
    <SheetContent className="w-full max-w-lg overflow-y-auto sm:max-w-lg">
      <form
        noValidate
        className="flex flex-col gap-5 p-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-2">
          <SheetTitle>{title}</SheetTitle>
          {account && (
            <AccountLabel
              code={account.code}
              name={account.name}
              className="text-muted-foreground"
            />
          )}
        </div>
        {used && (
          <Callout
            tone="info"
            icon={<LockIcon />}
            title={s.lockedTitle}
            description={s.lockedDescription}
          />
        )}
        {!used && hasChildren && (
          <Callout
            tone="info"
            icon={<LockIcon />}
            title={s.headerLockedTitle}
            description={s.headerLockedDescription}
          />
        )}
        {account && account.roles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-control font-medium">{s.roles}</span>
            {account.roles.map((role) => (
              <Badge key={role} tone="brand">
                {t.roles[role]}
              </Badge>
            ))}
          </div>
        )}
        <FormErrorSummary
          attempt={attempt}
          errors={[
            ['account-code', errors.code],
            ['account-name', errors.name],
            ['account-statement-line', errors.line],
            ['account-item-kind', errors.itemKind],
            ['account-counterparty-type', errors.counterpartyType],
          ]}
        />
        <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-5">
          {!isRoot && (
            <SelectField
              label={s.parent}
              value={form.parentId}
              options={parents.map((candidate) => ({
                value: candidate.id,
                label: `${candidate.code} ${candidate.name}`,
              }))}
              disabled={placeLocked}
              onValueChange={(value) => {
                const next = accounts.find((candidate) => candidate.id === value);
                setUnchanged(false);
                // A new account follows its new parent: the next free code and the level's kind.
                setForm((current) =>
                  account || !next
                    ? { ...current, parentId: value }
                    : {
                        ...current,
                        parentId: value,
                        code: nextChildCode(next, accounts) ?? next.code,
                        kind: defaultKind(next.level + 1),
                      },
                );
              }}
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="account-code" invalid={errors.code !== undefined} disabled={placeLocked}>
              <FieldLabel>{s.code}</FieldLabel>
              <Input
                dir="ltr"
                inputMode="numeric"
                value={form.code}
                maxLength={12}
                onChange={(event) => set('code', event.target.value.trim())}
              />
              {!placeLocked && <FieldDescription>{s.codeHint}</FieldDescription>}
              <FieldError match={errors.code !== undefined}>{errors.code}</FieldError>
            </Field>
            <div className="flex flex-col gap-2">
              <span className="text-control font-medium">{s.class}</span>
              <span className="flex h-control items-center text-control">
                {t.classes[accountClass]}
              </span>
            </div>
          </div>
          {!isRoot && (
            <SelectField
              label={s.kind}
              value={resolved.kind}
              options={kindOptions}
              disabled={placeLocked || kindFixed !== null}
              onValueChange={(value) => set('kind', value)}
            />
          )}
          <Field id="account-name" invalid={errors.name !== undefined}>
            <FieldLabel>{s.name}</FieldLabel>
            <Input
              value={form.name}
              maxLength={200}
              onChange={(event) => set('name', event.target.value)}
            />
            <FieldError match={errors.name !== undefined}>{errors.name}</FieldError>
          </Field>
          <Field>
            <FieldLabel>{s.nameLatin}</FieldLabel>
            <Input
              dir="ltr"
              value={form.nameLatin}
              maxLength={200}
              onChange={(event) => set('nameLatin', event.target.value)}
            />
          </Field>
          <SelectField
            label={s.normalBalance}
            value={resolved.normalBalance}
            options={balanceOptions}
            disabled={placeLocked}
            onValueChange={(value) => set('normalBalance', value)}
          />
          {resolved.kind === 'postable' && (
            <>
              <SelectField
                id="account-statement-line"
                label={s.statementLine}
                value={form.statementLine}
                placeholder={s.choose}
                options={lines.map((line) => ({ value: line.code, label: line.name }))}
                description={account ? s.statementLineHint : undefined}
                error={errors.line}
                onValueChange={(value) => set('statementLine', value)}
              />
              <SelectField
                label={s.currency}
                value={form.currency ?? noCurrency}
                options={currencyOptions}
                description={s.currencyHint}
                disabled={used}
                onValueChange={(value) => {
                  const currency = value === noCurrency ? null : (value as CurrencyCode);
                  setUnchanged(false);
                  // Q12 (owner, 2026-10-27): an asset or liability held in one currency is
                  // monetary by default, so the month-end revaluation (IAS 21.23) never skips it.
                  setForm((current) => ({
                    ...current,
                    currency,
                    isMonetary: currency !== null && flagsFit ? true : current.isMonetary,
                  }));
                }}
              />
              {flagsFit && (
                <>
                  <SwitchField
                    label={s.control}
                    description={s.controlHint}
                    checked={form.isControl}
                    disabled={readOnly || used}
                    onCheckedChange={(checked) => set('isControl', checked)}
                  />
                  {form.isControl && (
                    <SelectField
                      id="account-item-kind"
                      label={s.itemKind}
                      value={form.itemKind}
                      placeholder={s.choose}
                      options={itemKindOptions}
                      description={s.itemKindHint}
                      error={errors.itemKind}
                      disabled={readOnly || used}
                      onValueChange={(value) => set('itemKind', value as ItemKind)}
                    />
                  )}
                  {form.isControl && (
                    <SelectField
                      id="account-counterparty-type"
                      label={s.counterpartyType}
                      value={form.counterpartyType}
                      placeholder={s.choose}
                      options={counterpartyTypeOptions}
                      description={s.counterpartyTypeHint}
                      error={errors.counterpartyType}
                      disabled={readOnly || used}
                      onValueChange={(value) => {
                        const type = value as CounterpartyType;
                        const typeId = typeIdOf(type);
                        setUnchanged(false);
                        // S11 rule 5: the counterparty's dimension is required with the type.
                        setForm((current) => ({
                          ...current,
                          counterpartyType: type,
                          requiredDimensionTypeIds:
                            typeId === undefined ||
                            current.requiredDimensionTypeIds.includes(typeId)
                              ? current.requiredDimensionTypeIds
                              : [...current.requiredDimensionTypeIds, typeId],
                        }));
                      }}
                    />
                  )}
                  <SwitchField
                    label={s.monetary}
                    description={s.monetaryHint}
                    checked={form.isMonetary}
                    disabled={readOnly || used}
                    onCheckedChange={(checked) => set('isMonetary', checked)}
                  />
                </>
              )}
              {cashKindFits(resolved, accountClass) && (
                <SelectField
                  label={s.cashKind}
                  value={form.cashKind ?? noCashKind}
                  options={cashKindOptions}
                  description={s.cashKindHint}
                  disabled={readOnly || used}
                  onValueChange={(value) =>
                    set('cashKind', value === noCashKind ? null : (value as CashKind))
                  }
                />
              )}
              {requiresMaterialFits(resolved, accountClass) && (
                <SwitchField
                  label={s.requiresMaterial}
                  description={s.requiresMaterialHint}
                  checked={form.requiresMaterial}
                  disabled={readOnly || used}
                  onCheckedChange={(checked) => set('requiresMaterial', checked)}
                />
              )}
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 text-control font-medium">{s.dimensions}</legend>
                <p className="text-control text-muted-foreground">{s.dimensionsHint}</p>
                <FormError error={types.error} />
                {types.data
                  ?.filter(
                    (type) =>
                      type.archivedAt === null || form.requiredDimensionTypeIds.includes(type.id),
                  )
                  .map((type) => (
                    <SwitchField
                      key={type.id}
                      label={type.name}
                      description={
                        counterpartyTypeId === type.id ? s.counterpartyDimension : undefined
                      }
                      disabled={readOnly || counterpartyTypeId === type.id}
                      checked={form.requiredDimensionTypeIds.includes(type.id)}
                      onCheckedChange={(checked) =>
                        set(
                          'requiredDimensionTypeIds',
                          checked
                            ? [...form.requiredDimensionTypeIds, type.id]
                            : form.requiredDimensionTypeIds.filter((id) => id !== type.id),
                        )
                      }
                    />
                  ))}
              </fieldset>
            </>
          )}
        </fieldset>
        {unchanged && (
          <Callout role="status" tone="info" icon={<InfoIcon />} title={s.nothingChanged} />
        )}
        <FormError error={save.error} />
        <div className="flex flex-wrap gap-2">
          {!readOnly && (
            <Button type="submit" loading={save.isPending}>
              {account ? s.save : s.create}
            </Button>
          )}
          {used && account && account.kind === 'postable' && (
            <Button
              type="button"
              variant="outline"
              render={<Link to="/accounts/$id/lines" params={{ id: account.id }} />}
            >
              {ar.entries.lines.title}
            </Button>
          )}
          <SheetClose render={<Button type="button" variant="ghost" />}>
            {ar.common.close}
          </SheetClose>
        </div>
      </form>
    </SheetContent>
  );
}
