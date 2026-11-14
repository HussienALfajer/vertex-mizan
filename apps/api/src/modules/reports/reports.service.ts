import { Inject, Injectable } from '@nestjs/common';
import type {
  AccountStatement,
  AccountStatementQuery,
  BalanceSheet,
  BalanceSheetQuery,
  GeneralLedger,
  GeneralLedgerQuery,
  IncomeStatement,
  IncomeStatementQuery,
  Journal,
  JournalQuery,
  Profitability,
  ProfitabilityQuery,
  ReportLines,
  ReportLinesQuery,
  TrialBalance,
  TrialBalanceQuery,
} from '@vertex-mizan/contracts';
import {
  type Database,
  readAccountStatement,
  readBalanceSheet,
  readGeneralLedger,
  readIncomeStatement,
  readJournal,
  readProfitability,
  readReportLines,
  readTrialBalance,
  type Transaction,
  withCompany,
} from '@vertex-mizan/db';
import type { CompanyRouteAccess } from '../../core/access/access.js';
import { DATABASE } from '../../core/database/database.module.js';

/**
 * `/api/reports/*` (S09 "API"): every report read through `packages/db`'s readers in the company's
 * context, in one repeatable-read snapshot, so an entry posted while a report runs is either fully
 * in or fully out (edge case 1). Reads are not audited (S01 rule 24); an archived company's reports
 * stay readable.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  #read<T>(
    access: CompanyRouteAccess,
    work: (tx: Transaction, now: Date) => Promise<T>,
  ): Promise<T> {
    return withCompany(this.db, access.company.id, (tx) => work(tx, new Date()), {
      isolationLevel: 'repeatable read',
    });
  }

  trialBalance(access: CompanyRouteAccess, query: TrialBalanceQuery): Promise<TrialBalance> {
    return this.#read(access, (tx, now) => readTrialBalance(tx, query, now));
  }

  generalLedger(access: CompanyRouteAccess, query: GeneralLedgerQuery): Promise<GeneralLedger> {
    return this.#read(access, (tx, now) => readGeneralLedger(tx, query, now));
  }

  accountStatement(
    access: CompanyRouteAccess,
    accountId: string,
    query: AccountStatementQuery,
  ): Promise<AccountStatement> {
    return this.#read(access, (tx, now) => readAccountStatement(tx, accountId, query, now));
  }

  journal(access: CompanyRouteAccess, query: JournalQuery): Promise<Journal> {
    return this.#read(access, (tx, now) => readJournal(tx, query, now));
  }

  incomeStatement(
    access: CompanyRouteAccess,
    query: IncomeStatementQuery,
  ): Promise<IncomeStatement> {
    return this.#read(access, (tx, now) => readIncomeStatement(tx, query, now));
  }

  balanceSheet(access: CompanyRouteAccess, query: BalanceSheetQuery): Promise<BalanceSheet> {
    return this.#read(access, (tx, now) => readBalanceSheet(tx, query, now));
  }

  profitability(access: CompanyRouteAccess, query: ProfitabilityQuery): Promise<Profitability> {
    return this.#read(access, (tx, now) => readProfitability(tx, query, now));
  }

  lines(access: CompanyRouteAccess, query: ReportLinesQuery): Promise<ReportLines> {
    return this.#read(access, (tx, now) => readReportLines(tx, query, now));
  }
}
