import { useQuery } from '@tanstack/react-query';
import type {
  CashPosition,
  CashPositionAccount,
  CurrencyCode,
  VoucherPreview,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  AmountInput,
  CashAccountPicker,
  type CashAccountPickerOption,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  VoucherHeader,
} from '@vertex-mizan/ui';
import { useCompany } from '../../lib/session';
import type { EditDraft, EditVoucher, VoucherCashAccount } from '../entries/draft-lines';
import { cashPositionQuery } from './cash-queries';

const f = ar.cash.form;

/** What the voucher form checks before a save, a post or a submit (S11 rules 10–13). */
export interface VoucherProblems {
  cashAccount?: string | undefined;
  destination?: string | undefined;
  counted?: string | undefined;
  description?: string | undefined;
  date?: string | undefined;
}

/** The voucher's problems: its accounts always, a count's amount and reason before posting. */
export function voucherProblems(edit: EditDraft, posting: boolean): VoucherProblems {
  const voucher = edit.voucher;
  if (voucher === null) return {};
  return {
    cashAccount: voucher.cashAccountId === null ? f.errors.cashAccount : undefined,
    destination:
      voucher.kind !== 'transfer'
        ? undefined
        : voucher.counterCashAccountId === null
          ? f.errors.destination
          : voucher.counterCashAccountId === voucher.cashAccountId
            ? f.errors.sameAccount
            : undefined,
    counted:
      posting && voucher.kind === 'count' && voucher.countedMinor === null
        ? f.errors.counted
        : undefined,
  };
}

/** The cash accounts of the position as the picker lists them. */
export function cashPickerAccounts(position: CashPosition | undefined): CashAccountPickerOption[] {
  return (position?.groups ?? []).flatMap((group) =>
    group.accounts.map((account) => ({
      id: account.id,
      code: account.code,
      name: account.name,
      nameLatin: account.nameLatin,
      currency: account.currency,
      kindLabel: ar.cash.cashKinds[account.cashKind],
      balanceMinor: BigInt(account.balance.amountMinor),
    })),
  );
}

export const cashPickerLabels = {
  ...ar.cash.picker,
  blocked: ar.accounting.account.blocked,
  currency: (currency: CurrencyCode) => ar.accounting.currencies[currency],
};

/** The cash accounts at the end of a date, for the voucher's pickers and balances. */
export function useCashAccounts(asOf: string) {
  const { companyId } = useCompany();
  const position = useQuery(cashPositionQuery(companyId, asOf || undefined));
  const accounts = (position.data?.groups ?? []).flatMap((group) => group.accounts);
  return { position: position.data, accounts };
}

/**
 * The voucher's header on the entry screen (S11 "Screens"): `VoucherHeader` with the date, the
 * cash account (a transfer's source and destination), the party, the description (a count's
 * reason) and the reference; a count's counted amount with the expected balance and the difference
 * from the preview; a transfer's derived rate from the preview. The number appears only after
 * posting.
 */
export function VoucherFields({
  edit,
  voucher,
  editable,
  problems,
  preview,
  onChange,
  onCashAccount,
  onDestination,
  onParty,
  onCounted,
  onCountedError,
}: {
  edit: EditDraft;
  voucher: EditVoucher;
  editable: boolean;
  problems: VoucherProblems;
  /** The preview's voucher part, when the shown preview is current. */
  preview: VoucherPreview | null;
  onChange: (change: Partial<Pick<EditDraft, 'entryDate' | 'description' | 'reference'>>) => void;
  onCashAccount: (account: VoucherCashAccount) => void;
  onDestination: (account: VoucherCashAccount) => void;
  onParty: (partyName: string) => void;
  onCounted: (countedMinor: bigint | null) => void;
  /** A counted amount whose text is refused: the form holds it as an error. */
  onCountedError: (refused: boolean) => void;
}) {
  const { position, accounts } = useCashAccounts(edit.entryDate);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const options = cashPickerAccounts(position).filter(
    // A count is of a box (S11 rule 13).
    (option) => voucher.kind !== 'count' || byId.get(option.id)?.cashKind === 'box',
  );
  const source = voucher.cashAccountId ? byId.get(voucher.cashAccountId) : undefined;
  const destination = voucher.counterCashAccountId
    ? byId.get(voucher.counterCashAccountId)
    : undefined;
  const headerAccount = (role: string, account: CashPositionAccount | undefined) =>
    account
      ? [
          {
            role,
            code: account.code,
            name: account.name,
            currency: account.currency,
            balanceMinor: BigInt(account.balance.amountMinor),
          },
        ]
      : [];
  const transfer = voucher.kind === 'transfer';
  const count = voucher.kind === 'count';
  const currency = source?.currency ?? 'USD';
  const party =
    voucher.kind === 'receipt'
      ? f.partyReceipt
      : voucher.kind === 'payment'
        ? f.partyPayment
        : transfer
          ? f.partyTransfer
          : null;
  const pick = (id: string) => {
    const account = byId.get(id);
    return account ? { id, currency: account.currency } : null;
  };
  return (
    <VoucherHeader
      kind={ar.cash.kinds[voucher.kind]}
      number={null}
      labels={f}
      accounts={[
        ...headerAccount(transfer ? f.source : f.cashAccount, source),
        ...(transfer ? headerAccount(f.destination, destination) : []),
      ]}
    >
      <Field id="draft-date" invalid={problems.date !== undefined}>
        <FieldLabel>{f.date}</FieldLabel>
        <Input
          type="date"
          dir="ltr"
          value={edit.entryDate}
          readOnly={!editable}
          onChange={(event) => onChange({ entryDate: event.target.value })}
        />
        <FieldError match={problems.date !== undefined}>{problems.date}</FieldError>
      </Field>
      <CashAccountPicker
        id="voucher-cash-account"
        label={transfer ? f.source : count ? f.box : f.cashAccount}
        accounts={options}
        value={voucher.cashAccountId}
        disabled={!editable}
        labels={cashPickerLabels}
        error={problems.cashAccount}
        onValueChange={(id) => {
          const account = pick(id);
          if (account) onCashAccount(account);
        }}
      />
      {transfer && (
        <CashAccountPicker
          id="voucher-destination"
          label={f.destination}
          accounts={options}
          value={voucher.counterCashAccountId}
          disabled={!editable}
          labels={cashPickerLabels}
          error={problems.destination}
          onValueChange={(id) => {
            const account = pick(id);
            if (account) onDestination(account);
          }}
        />
      )}
      {party !== null && (
        <Field>
          <FieldLabel>{party}</FieldLabel>
          <Input
            value={voucher.partyName}
            maxLength={200}
            readOnly={!editable}
            onChange={(event) => onParty(event.target.value)}
          />
        </Field>
      )}
      {count && (
        <Field id="voucher-counted" invalid={problems.counted !== undefined}>
          <FieldLabel>{f.counted}</FieldLabel>
          <AmountInput
            currency={currency}
            value={voucher.countedMinor}
            allowNegative={false}
            readOnly={!editable}
            onValueChange={onCounted}
            onTextError={(error) => onCountedError(error !== null)}
          />
          <FieldDescription>{f.countHint}</FieldDescription>
          <FieldError match={problems.counted !== undefined}>{problems.counted}</FieldError>
        </Field>
      )}
      <Field
        id="draft-description"
        className="sm:col-span-2"
        invalid={problems.description !== undefined}
      >
        <FieldLabel>{count ? f.reason : f.description}</FieldLabel>
        <Input
          value={edit.description}
          maxLength={500}
          readOnly={!editable}
          onChange={(event) => onChange({ description: event.target.value })}
        />
        <FieldError match={problems.description !== undefined}>{problems.description}</FieldError>
      </Field>
      {!count && (
        <Field>
          <FieldLabel>{f.reference}</FieldLabel>
          <Input
            value={edit.reference}
            maxLength={100}
            readOnly={!editable}
            onChange={(event) => onChange({ reference: event.target.value })}
          />
        </Field>
      )}
      {count && preview?.expectedMinor != null && (
        <dl className="flex flex-col gap-1 sm:col-span-2" data-slot="voucher-count-facts">
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">{f.expected}</dt>
            <dd>
              <Amount value={BigInt(preview.expectedMinor)} currency={currency} showCurrency />
            </dd>
          </div>
          {preview.differenceMinor != null && (
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">
                {preview.differenceMinor === '0'
                  ? f.match
                  : preview.differenceMinor.startsWith('-')
                    ? f.shortage
                    : f.overage}
              </dt>
              <dd>
                <Amount value={BigInt(preview.differenceMinor)} currency={currency} showCurrency />
              </dd>
            </div>
          )}
        </dl>
      )}
      {count && preview === null && <p className="text-muted-foreground">{f.previewNeeded}</p>}
      {transfer && preview?.derivedRate && (
        <div className="flex items-baseline gap-2" data-slot="voucher-derived-rate">
          <span className="text-muted-foreground">{f.derivedRate}</span>
          <bdi dir="ltr" className="font-medium">
            {`1 ${preview.derivedRate.base} = ${preview.derivedRate.rate} ${preview.derivedRate.quote}`}
          </bdi>
        </div>
      )}
    </VoucherHeader>
  );
}
