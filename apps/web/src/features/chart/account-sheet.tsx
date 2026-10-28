import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type Account,
  type AccountClass,
  type AccountKind,
  type AccountLevel,
  accountClassOfCode,
  accountCodeLevel,
  accountSchema,
  CURRENCY_CODES,
  type CurrencyCode,
  checkAccountCode,
  createAccountSchema,
  defaultNormalBalance,
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
  isMonetary: boolean;
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
      isMonetary: false,
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
    isMonetary: account.isMonetary,
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

/** The fields a postable account sends, emptied on a header (S02 check 4). */
function shaped(form: ResolvedForm, accountClass: AccountClass) {
  const postable = form.kind === 'postable';
  const flags = postable && (accountClass === 'asset' || accountClass === 'liability');
  return {
    statementLine: postable ? form.statementLine : null,
    currency: postable ? form.currency : null,
    isControl: flags && form.isControl,
    isMonetary: flags && form.isMonetary,
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
  if (next.isMonetary !== account.isMonetary) change.isMonetary = next.isMonetary;
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
  const [errors, setErrors] = useState<{ code?: string; name?: string; line?: string }>({});
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
  const lines = STATEMENT_LINES.filter((line) => statementLineFits(line.code, accountClass));
  const flagsFit = accountClass === 'asset' || accountClass === 'liability';
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
                  <SwitchField
                    label={s.monetary}
                    description={s.monetaryHint}
                    checked={form.isMonetary}
                    disabled={readOnly || used}
                    onCheckedChange={(checked) => set('isMonetary', checked)}
                  />
                </>
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
                      disabled={readOnly}
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
          <SheetClose render={<Button type="button" variant="ghost" />}>
            {ar.common.close}
          </SheetClose>
        </div>
      </form>
    </SheetContent>
  );
}
