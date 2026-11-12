import type {
  ChartTemplateId,
  CompanyLedgers,
  CurrencyCode,
  RateType,
} from '@vertex-mizan/contracts';
import { type AuditActor, writeCompanyAudit, writePlatformAudit } from '../audit.js';
import type { Transaction } from '../client.js';
import { companies, companySettings } from '../schema/companies.js';
import { applyChartTemplate } from './chart.js';

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

/** A new company's books, as the web form and `admin:create-company` give them (S01 rule 9). */
export interface NewCompanyBooks {
  readonly name: string;
  readonly nameLatin: string | null;
  readonly ledgers: CompanyLedgers;
  readonly fiscalYearStartMonth: number;
  readonly policyNote: string;
  readonly template: ChartTemplateId | null;
  /** Null for a company a server command made. */
  readonly createdByUserId: string | null;
  /** The books start (S10 rule 1): the first day of a month; none for a company without one. */
  readonly booksStart?: string | null;
}

/**
 * A company and its books, in the caller's transaction inside `withCompany(companyId)`: the
 * company, its settings (whose insert makes the five root accounts, the built-in dimension types
 * and the ledger head), the platform audit row and the chart template chosen (S02 rule 1). The web
 * form adds the creator's membership, the server command the owner's invitation; the scenario
 * book's setup uses it as is.
 */
export async function createCompanyBooks(
  tx: Transaction,
  companyId: string,
  input: NewCompanyBooks,
  actor: AuditActor,
): Promise<{ company: CompanyRow; settings: SettingsRow }> {
  const [company] = await tx
    .insert(companies)
    .values({
      id: companyId,
      name: input.name,
      nameLatin: input.nameLatin,
      createdByUserId: input.createdByUserId,
    })
    .returning();
  const [settings] = await tx
    .insert(companySettings)
    .values({
      companyId,
      ...ledgerColumns(input.ledgers),
      fiscalYearStartMonth: input.fiscalYearStartMonth,
      policyNote: input.policyNote,
      booksStart: input.booksStart ?? null,
    })
    .returning();
  if (!company || !settings) throw new Error('The company was not created');
  await writePlatformAudit(tx, { action: 'company.created', actor, subjectCompanyId: companyId });
  if (settings.booksStart !== null) {
    await writeCompanyAudit(tx, companyId, actor, {
      action: 'company.books_start_set',
      entityType: 'company_settings',
      entityId: settings.id,
      before: { booksStart: null },
      after: { booksStart: settings.booksStart },
    });
  }
  if (input.template !== null) await applyChartTemplate(tx, companyId, input.template, actor);
  return { company, settings };
}
