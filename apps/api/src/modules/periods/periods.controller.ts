import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type PeriodDetail,
  type PeriodParam,
  type PeriodReason,
  type PeriodReopenResult,
  type PeriodSummary,
  type PeriodsQuery,
  periodDetailSchema,
  periodParamSchema,
  periodReasonSchema,
  periodReopenResultSchema,
  periodSummarySchema,
  periodsQuerySchema,
} from '@vertex-mizan/contracts';
import { z } from 'zod';
import { Access, CompanyRoute, inCompany, type RequestAccess } from '../../core/access/access.js';
import {
  ApiErrors,
  COMPANY_READ_ERRORS,
  COMPANY_WRITE_ERRORS,
} from '../../core/http/api-errors.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import { PeriodsService } from './periods.service.js';

/** `/api/periods` (S07 "API"): the months, a month's checklist and history, its close and reopen. */
@ApiTags('periods')
@Controller('periods')
export class PeriodsController {
  constructor(@Inject(PeriodsService) private readonly periods: PeriodsService) {}

  @Get()
  @ApiQueryFrom(periodsQuerySchema)
  @CompanyRoute('periods.read')
  @SerializeOptions({ schema: periodSummarySchema })
  @ApiOkResponse({
    description:
      'Each month of the range (the first period to this month by default, at most 24): its state, whether it has ended, its last event and how many checklist items fail',
    standardSchema: z.array(periodSummarySchema),
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  list(
    @Access() access: RequestAccess,
    @Query({ schema: periodsQuerySchema }) query: PeriodsQuery,
  ): Promise<PeriodSummary[]> {
    return this.periods.list(inCompany(access), query);
  }

  @Get(':period')
  @ApiParamsFrom(periodParamSchema)
  @CompanyRoute('periods.read')
  @SerializeOptions({ schema: periodDetailSchema })
  @ApiOkResponse({
    description: 'The month’s state, its history of closes and reopens, and its checklist',
    standardSchema: periodDetailSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  read(
    @Access() access: RequestAccess,
    @Param({ schema: periodParamSchema }) params: PeriodParam,
  ): Promise<PeriodDetail> {
    return this.periods.read(inCompany(access), params.period);
  }

  @Post(':period/close')
  @HttpCode(200)
  @ApiParamsFrom(periodParamSchema)
  @CompanyRoute('periods.close')
  @SerializeOptions({ schema: periodDetailSchema })
  @ApiOkResponse({
    description: 'The month closed, with the checklist it passed',
    standardSchema: periodDetailSchema,
  })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'PERIOD_CLOSED',
    'PERIOD_NOT_ENDED',
    'PERIOD_ORDER',
    'CHECKLIST_FAILED',
  )
  close(
    @Access() access: RequestAccess,
    @Param({ schema: periodParamSchema }) params: PeriodParam,
    @Body({ schema: periodReasonSchema }) body: PeriodReason,
  ): Promise<PeriodDetail> {
    return this.periods.close(inCompany(access), params.period, body.reason);
  }

  @Post(':period/reopen')
  @HttpCode(200)
  @ApiParamsFrom(periodParamSchema)
  @CompanyRoute('periods.close')
  @SerializeOptions({ schema: periodReopenResultSchema })
  @ApiOkResponse({
    description: 'The month reopened, and how many held events were queued for retry',
    standardSchema: periodReopenResultSchema,
  })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'PERIOD_NOT_CLOSED', 'PERIOD_ORDER')
  reopen(
    @Access() access: RequestAccess,
    @Param({ schema: periodParamSchema }) params: PeriodParam,
    @Body({ schema: periodReasonSchema }) body: PeriodReason,
  ): Promise<PeriodReopenResult> {
    return this.periods.reopen(inCompany(access), params.period, body.reason);
  }
}
