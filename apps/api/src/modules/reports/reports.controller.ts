import { Controller, Get, Inject, Param, Query, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AccountStatement,
  type AccountStatementQuery,
  accountStatementQuerySchema,
  accountStatementSchema,
  type BalanceSheet,
  type BalanceSheetQuery,
  balanceSheetQuerySchema,
  balanceSheetSchema,
  type ContractPosition,
  type ContractPositionQuery,
  contractPositionQuerySchema,
  contractPositionSchema,
  type GeneralLedger,
  type GeneralLedgerQuery,
  generalLedgerQuerySchema,
  generalLedgerSchema,
  type IdParam,
  type IncomeStatement,
  type IncomeStatementQuery,
  idParamSchema,
  incomeStatementQuerySchema,
  incomeStatementSchema,
  type Journal,
  type JournalQuery,
  journalQuerySchema,
  journalSchema,
  type Profitability,
  type ProfitabilityQuery,
  profitabilityQuerySchema,
  profitabilitySchema,
  type ReportLines,
  type ReportLinesQuery,
  type RevenueReleaseSchedule,
  type RevenueReleaseScheduleQuery,
  reportLinesQuerySchema,
  reportLinesSchema,
  revenueReleaseScheduleQuerySchema,
  revenueReleaseScheduleSchema,
  type TrialBalance,
  type TrialBalanceQuery,
  trialBalanceQuerySchema,
  trialBalanceSchema,
} from '@vertex-mizan/contracts';
import { Access, CompanyRoute, inCompany, type RequestAccess } from '../../core/access/access.js';
import { ApiErrors, COMPANY_READ_ERRORS } from '../../core/http/api-errors.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import { ReportsService } from './reports.service.js';

/**
 * `/api/reports/*` (S09 "API"): every report with `reports.read`, held by every role; a read of
 * the company in the session, in one snapshot (`ReportsService`). Another company's account is
 * `NOT_FOUND`; its values and contracts read as nothing.
 */
@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Get('trial-balance')
  @ApiQueryFrom(trialBalanceQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: trialBalanceSchema })
  @ApiOkResponse({
    description:
      'The trial balance: six columns per account at the level, totals in pairs, the comparative and the marks',
    standardSchema: trialBalanceSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async trialBalance(
    @Access() access: RequestAccess,
    @Query({ schema: trialBalanceQuerySchema }) query: TrialBalanceQuery,
  ): Promise<TrialBalance> {
    return this.reports.trialBalance(inCompany(access), query);
  }

  @Get('general-ledger')
  @ApiQueryFrom(generalLedgerQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: generalLedgerSchema })
  @ApiOkResponse({
    description:
      'The general ledger of a code range, 200 lines a page, each account with its opening and closing',
    standardSchema: generalLedgerSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async generalLedger(
    @Access() access: RequestAccess,
    @Query({ schema: generalLedgerQuerySchema }) query: GeneralLedgerQuery,
  ): Promise<GeneralLedger> {
    return this.reports.generalLedger(inCompany(access), query);
  }

  @Get('accounts/:id/statement')
  @ApiParamsFrom(idParamSchema)
  @ApiQueryFrom(accountStatementQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: accountStatementSchema })
  @ApiOkResponse({
    description: 'An account’s statement with ledger and transaction running balances per currency',
    standardSchema: accountStatementSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND')
  async accountStatement(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Query({ schema: accountStatementQuerySchema }) query: AccountStatementQuery,
  ): Promise<AccountStatement> {
    return this.reports.accountStatement(inCompany(access), params.id, query);
  }

  @Get('journal')
  @ApiQueryFrom(journalQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: journalSchema })
  @ApiOkResponse({
    description: 'Posted entries in (entry_date, number) order with their lines',
    standardSchema: journalSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async journal(
    @Access() access: RequestAccess,
    @Query({ schema: journalQuerySchema }) query: JournalQuery,
  ): Promise<Journal> {
    return this.reports.journal(inCompany(access), query);
  }

  @Get('income-statement')
  @ApiQueryFrom(incomeStatementQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: incomeStatementSchema })
  @ApiOkResponse({
    description: 'The income statement by nature with its IFRS 18 subtotals and comparative',
    standardSchema: incomeStatementSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async incomeStatement(
    @Access() access: RequestAccess,
    @Query({ schema: incomeStatementQuerySchema }) query: IncomeStatementQuery,
  ): Promise<IncomeStatement> {
    return this.reports.incomeStatement(inCompany(access), query);
  }

  @Get('balance-sheet')
  @ApiQueryFrom(balanceSheetQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: balanceSheetSchema })
  @ApiOkResponse({
    description:
      'The balance sheet: contract positions netted, counterparties on their own side, the year’s result in equity',
    standardSchema: balanceSheetSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async balanceSheet(
    @Access() access: RequestAccess,
    @Query({ schema: balanceSheetQuerySchema }) query: BalanceSheetQuery,
  ): Promise<BalanceSheet> {
    return this.reports.balanceSheet(inCompany(access), query);
  }

  @Get('profitability')
  @ApiQueryFrom(profitabilityQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: profitabilitySchema })
  @ApiOkResponse({
    description:
      'Revenue, direct costs, contribution and margin by client, contract, department or service',
    standardSchema: profitabilitySchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async profitability(
    @Access() access: RequestAccess,
    @Query({ schema: profitabilityQuerySchema }) query: ProfitabilityQuery,
  ): Promise<Profitability> {
    return this.reports.profitability(inCompany(access), query);
  }

  @Get('contract-position')
  @ApiQueryFrom(contractPositionQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: contractPositionSchema })
  @ApiOkResponse({
    description:
      'Each contract’s gross positions and net, with totals agreeing with the balance sheet',
    standardSchema: contractPositionSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async contractPosition(
    @Access() access: RequestAccess,
    @Query({ schema: contractPositionQuerySchema }) query: ContractPositionQuery,
  ): Promise<ContractPosition> {
    return this.reports.contractPosition(inCompany(access), query);
  }

  @Get('revenue-schedule')
  @ApiQueryFrom(revenueReleaseScheduleQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: revenueReleaseScheduleSchema })
  @ApiOkResponse({
    description:
      'The revenue releases still to post per month and contract, and what waits for a done',
    standardSchema: revenueReleaseScheduleSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async revenueSchedule(
    @Access() access: RequestAccess,
    @Query({ schema: revenueReleaseScheduleQuerySchema }) query: RevenueReleaseScheduleQuery,
  ): Promise<RevenueReleaseSchedule> {
    return this.reports.revenueSchedule(inCompany(access), query);
  }

  @Get('lines')
  @ApiQueryFrom(reportLinesQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: reportLinesSchema })
  @ApiOkResponse({
    description: 'The lines behind a figure, 200 a page, with their sum',
    standardSchema: reportLinesSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND')
  async lines(
    @Access() access: RequestAccess,
    @Query({ schema: reportLinesQuerySchema }) query: ReportLinesQuery,
  ): Promise<ReportLines> {
    return this.reports.lines(inCompany(access), query);
  }
}
