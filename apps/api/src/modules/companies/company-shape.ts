import type { Company, CompanyLedgers, CurrencyCode, RateType } from '@vertex-mizan/contracts';
import type { companies, companySettings } from '@vertex-mizan/db';

type CompanyRow = typeof companies.$inferSelect;
type SettingsRow = typeof companySettings.$inferSelect;

/** The settings columns of a company's ledgers (ADR 0007), as stored. */
export function ledgerColumns(ledgers: CompanyLedgers) {
  return {
    bookCurrency: ledgers.book.currency,
    bookRateType: ledgers.book.ratePolicy.rateType,
    bookAcceptsTransactionRate: ledgers.book.ratePolicy.acceptsTransactionRate,
    parallelCurrency: ledgers.parallel?.currency ?? null,
    parallelRateType: ledgers.parallel?.ratePolicy.rateType ?? null,
    parallelAcceptsTransactionRate: ledgers.parallel?.ratePolicy.acceptsTransactionRate ?? null,
  };
}

/** The ledgers as `companyLedgersSchema` reads them; the database checks keep the columns whole. */
export function ledgersOf(settings: SettingsRow): CompanyLedgers {
  return {
    book: {
      currency: settings.bookCurrency as CurrencyCode,
      ratePolicy: {
        rateType: settings.bookRateType as RateType,
        acceptsTransactionRate: settings.bookAcceptsTransactionRate,
      },
    },
    parallel:
      settings.parallelCurrency && settings.parallelRateType
        ? {
            currency: settings.parallelCurrency as CurrencyCode,
            ratePolicy: {
              rateType: settings.parallelRateType as RateType,
              acceptsTransactionRate: settings.parallelAcceptsTransactionRate ?? false,
            },
          }
        : null,
  };
}

/** A company as the API answers it (`companySchema`). */
export function companyOf(company: CompanyRow, settings: SettingsRow): Company {
  return {
    id: company.id,
    name: company.name,
    nameLatin: company.nameLatin,
    ledgers: ledgersOf(settings),
    fiscalYearStartMonth: settings.fiscalYearStartMonth,
    policyNote: settings.policyNote,
    booksStarted: settings.booksStartedAt !== null,
    archived:
      company.archivedAt && company.archivedReason
        ? { at: company.archivedAt.toISOString(), reason: company.archivedReason }
        : null,
    createdAt: company.createdAt.toISOString(),
  };
}

/** The audited settings fields (`AUDITED_FIELDS.company_settings`) of a settings row. */
export function auditedLedgerFields(settings: SettingsRow) {
  return {
    bookCurrency: settings.bookCurrency,
    bookRateType: settings.bookRateType,
    bookAcceptsTransactionRate: settings.bookAcceptsTransactionRate,
    parallelCurrency: settings.parallelCurrency,
    parallelRateType: settings.parallelRateType,
    parallelAcceptsTransactionRate: settings.parallelAcceptsTransactionRate,
    fiscalYearStartMonth: settings.fiscalYearStartMonth,
  };
}
