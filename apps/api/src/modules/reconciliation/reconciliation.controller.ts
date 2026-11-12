import { Controller, Get, Inject, Param, Query, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type ReconciliationCounts,
  type ReconciliationDay,
  type ReconciliationDayParam,
  type ReconciliationDayQuery,
  type ReconciliationMonth,
  type ReconciliationMonthQuery,
  reconciliationCountsSchema,
  reconciliationDayParamSchema,
  reconciliationDayQuerySchema,
  reconciliationDaySchema,
  reconciliationMonthQuerySchema,
  reconciliationMonthSchema,
} from '@vertex-mizan/contracts';
import { Access, CompanyRoute, inCompany, type RequestAccess } from '../../core/access/access.js';
import { ApiErrors, COMPANY_READ_ERRORS } from '../../core/http/api-errors.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import { ReconciliationService } from './reconciliation.service.js';

/** `/api/reconciliation` (S08 "API", "Screens"): the daily reconciliation with Hub, read only. */
@ApiTags('reconciliation')
@Controller('reconciliation')
export class ReconciliationController {
  constructor(
    @Inject(ReconciliationService) private readonly reconciliation: ReconciliationService,
  ) {}

  @Get('days')
  @ApiQueryFrom(reconciliationMonthQuerySchema)
  @CompanyRoute('reconciliation.read')
  @SerializeOptions({ schema: reconciliationMonthSchema })
  @ApiOkResponse({
    description:
      'The month’s days, each with its state and each client’s counts and gaps, and the matched days in a row up to yesterday',
    standardSchema: reconciliationMonthSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND')
  month(
    @Access() access: RequestAccess,
    @Query({ schema: reconciliationMonthQuerySchema }) query: ReconciliationMonthQuery,
  ): Promise<ReconciliationMonth> {
    return this.reconciliation.month(inCompany(access), query);
  }

  @Get('counts')
  @CompanyRoute('reconciliation.read')
  @SerializeOptions({ schema: reconciliationCountsSchema })
  @ApiOkResponse({
    description:
      'The sidebar’s count: the ended days with a missing report or differences, in months still open',
    standardSchema: reconciliationCountsSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS)
  counts(@Access() access: RequestAccess): Promise<ReconciliationCounts> {
    return this.reconciliation.counts(inCompany(access));
  }

  @Get('days/:date')
  @ApiParamsFrom(reconciliationDayParamSchema)
  @ApiQueryFrom(reconciliationDayQuerySchema)
  @CompanyRoute('reconciliation.read')
  @SerializeOptions({ schema: reconciliationDaySchema })
  @ApiOkResponse({
    description:
      'The day per client: its state, the totals on both sides, the differences, the annotations and the date’s reports',
    standardSchema: reconciliationDaySchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND')
  day(
    @Access() access: RequestAccess,
    @Param({ schema: reconciliationDayParamSchema }) params: ReconciliationDayParam,
    @Query({ schema: reconciliationDayQuerySchema }) query: ReconciliationDayQuery,
  ): Promise<ReconciliationDay> {
    return this.reconciliation.day(inCompany(access), params.date, query.client);
  }
}
