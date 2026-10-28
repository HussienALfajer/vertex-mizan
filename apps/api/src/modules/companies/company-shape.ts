import type { Company } from '@vertex-mizan/contracts';
import { type companies, type companySettings, ledgersOf } from '@vertex-mizan/db';

export { ledgerColumns, ledgersOf } from '@vertex-mizan/db';

type CompanyRow = typeof companies.$inferSelect;
type SettingsRow = typeof companySettings.$inferSelect;

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
