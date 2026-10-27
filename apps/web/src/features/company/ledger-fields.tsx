import {
  type CompanyLedgers,
  CURRENCY_CODES,
  type CurrencyCode,
  RATE_TYPES,
  type RateType,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { SelectField, SwitchField } from '../../components/form-fields';
import { formatMonthName } from '../../lib/format';

const t = ar.company;

/** The ledger settings as the form holds them: the parallel ledger kept while switched off. */
export interface LedgerForm {
  bookCurrency: CurrencyCode;
  bookRateType: RateType;
  bookAcceptsTransactionRate: boolean;
  hasParallel: boolean;
  parallelCurrency: CurrencyCode;
  parallelRateType: RateType;
  parallelAcceptsTransactionRate: boolean;
  fiscalYearStartMonth: number;
}

/**
 * Vertex Media's shape (S01 rule 10): book SYP at the bulletin rate; parallel USD at the market
 * rate, accepting the transaction's own rate; the fiscal year from January.
 */
export const vertexMediaLedgers: LedgerForm = {
  bookCurrency: 'SYP',
  bookRateType: 'bulletin',
  bookAcceptsTransactionRate: false,
  hasParallel: true,
  parallelCurrency: 'USD',
  parallelRateType: 'market',
  parallelAcceptsTransactionRate: true,
  fiscalYearStartMonth: 1,
};

export function ledgerFormOf(ledgers: CompanyLedgers, fiscalYearStartMonth: number): LedgerForm {
  const parallel = ledgers.parallel;
  return {
    bookCurrency: ledgers.book.currency,
    bookRateType: ledgers.book.ratePolicy.rateType,
    bookAcceptsTransactionRate: ledgers.book.ratePolicy.acceptsTransactionRate,
    hasParallel: parallel !== null,
    parallelCurrency: parallel?.currency ?? (ledgers.book.currency === 'USD' ? 'SYP' : 'USD'),
    parallelRateType: parallel?.ratePolicy.rateType ?? 'market',
    parallelAcceptsTransactionRate: parallel?.ratePolicy.acceptsTransactionRate ?? false,
    fiscalYearStartMonth,
  };
}

/** The ledgers to send (`companyLedgersSchema`): a bulletin ledger never accepts a deal's rate. */
export function ledgersOf(form: LedgerForm): CompanyLedgers {
  return {
    book: {
      currency: form.bookCurrency,
      ratePolicy: {
        rateType: form.bookRateType,
        acceptsTransactionRate: form.bookRateType === 'market' && form.bookAcceptsTransactionRate,
      },
    },
    parallel: form.hasParallel
      ? {
          currency: form.parallelCurrency,
          ratePolicy: {
            rateType: form.parallelRateType,
            acceptsTransactionRate:
              form.parallelRateType === 'market' && form.parallelAcceptsTransactionRate,
          },
        }
      : null,
  };
}

/** Why the ledgers cannot be sent (S01 edge case 8), or `undefined`. */
export function ledgerFormError(form: LedgerForm): string | undefined {
  return form.hasParallel && form.parallelCurrency === form.bookCurrency
    ? t.validation.sameCurrency
    : undefined;
}

const currencyOptions = CURRENCY_CODES.map((code) => ({
  value: code,
  label: `${ar.accounting.currencies[code]} (${code})`,
}));
const rateTypeOptions = RATE_TYPES.map((type) => ({ value: type, label: t.rateTypes[type] }));
const monthOptions = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: formatMonthName(index + 1),
}));

/** The book and parallel ledgers with their rate policies, and the fiscal year start (ADR 0007). */
export function LedgerFields({
  value,
  onChange,
  disabled,
}: {
  value: LedgerForm;
  onChange: (value: LedgerForm) => void;
  disabled?: boolean;
}) {
  const set = (change: Partial<LedgerForm>) => onChange({ ...value, ...change });
  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex min-w-0 flex-col gap-4">
        <legend className="mb-1 font-bold text-foreground">{t.fields.bookLedger}</legend>
        <p className="text-control text-muted-foreground">{t.fields.bookLedgerHint}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t.fields.currency}
            value={value.bookCurrency}
            options={currencyOptions}
            onValueChange={(bookCurrency) => set({ bookCurrency })}
            disabled={disabled}
          />
          <SelectField
            label={t.fields.rateType}
            value={value.bookRateType}
            options={rateTypeOptions}
            onValueChange={(bookRateType) => set({ bookRateType })}
            disabled={disabled}
          />
        </div>
        <SwitchField
          label={t.fields.acceptsTransactionRate}
          description={t.fields.acceptsTransactionRateHint}
          checked={value.bookRateType === 'market' && value.bookAcceptsTransactionRate}
          onCheckedChange={(bookAcceptsTransactionRate) => set({ bookAcceptsTransactionRate })}
          disabled={disabled || value.bookRateType !== 'market'}
        />
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-4">
        <legend className="mb-1 font-bold text-foreground">{t.fields.parallelLedger}</legend>
        <p className="text-control text-muted-foreground">{t.fields.parallelLedgerHint}</p>
        <SwitchField
          label={t.fields.hasParallel}
          checked={value.hasParallel}
          onCheckedChange={(hasParallel) => set({ hasParallel })}
          disabled={disabled}
        />
        {value.hasParallel && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label={t.fields.currency}
                value={value.parallelCurrency}
                options={currencyOptions}
                onValueChange={(parallelCurrency) => set({ parallelCurrency })}
                error={ledgerFormError(value)}
                disabled={disabled}
              />
              <SelectField
                label={t.fields.rateType}
                value={value.parallelRateType}
                options={rateTypeOptions}
                onValueChange={(parallelRateType) => set({ parallelRateType })}
                disabled={disabled}
              />
            </div>
            <SwitchField
              label={t.fields.acceptsTransactionRate}
              description={t.fields.acceptsTransactionRateHint}
              checked={value.parallelRateType === 'market' && value.parallelAcceptsTransactionRate}
              onCheckedChange={(parallelAcceptsTransactionRate) =>
                set({ parallelAcceptsTransactionRate })
              }
              disabled={disabled || value.parallelRateType !== 'market'}
            />
          </>
        )}
      </fieldset>
      <div className="sm:max-w-xs">
        <SelectField
          label={t.fields.fiscalYearStart}
          description={t.fields.fiscalYearStartHint}
          value={String(value.fiscalYearStartMonth)}
          options={monthOptions}
          onValueChange={(month) => set({ fiscalYearStartMonth: Number(month) })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
