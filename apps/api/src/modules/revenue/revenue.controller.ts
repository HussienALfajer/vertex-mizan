import { Controller, Get, Inject, Param, Query, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type IdParam,
  idParamSchema,
  type RevenueMonth,
  type RevenueMonthsQuery,
  type RevenuePreview,
  type RevenuePreviewQuery,
  type RevenueScheduleDetail,
  type RevenueSchedulePage,
  type RevenueScheduleQuery,
  revenueMonthSchema,
  revenueMonthsQuerySchema,
  revenuePreviewQuerySchema,
  revenuePreviewSchema,
  revenueScheduleDetailSchema,
  revenueSchedulePageSchema,
  revenueScheduleQuerySchema,
} from '@vertex-mizan/contracts';
import { z } from 'zod';
import { Access, CompanyRoute, inCompany, type RequestAccess } from '../../core/access/access.js';
import { ApiErrors, COMPANY_READ_ERRORS } from '../../core/http/api-errors.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import { RevenueService } from './revenue.service.js';

/** `/api/revenue` (S06 "API"): recognition schedules, months and the month's preview. */
@ApiTags('revenue')
@Controller('revenue')
export class RevenueController {
  constructor(@Inject(RevenueService) private readonly revenue: RevenueService) {}

  @Get('schedules')
  @ApiQueryFrom(revenueScheduleQuerySchema)
  @CompanyRoute('recognition.read')
  @SerializeOptions({ schema: revenueSchedulePageSchema })
  @ApiOkResponse({
    description: 'Recognition schedules, newest first',
    standardSchema: revenueSchedulePageSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async schedules(
    @Access() access: RequestAccess,
    @Query({ schema: revenueScheduleQuerySchema }) query: RevenueScheduleQuery,
  ): Promise<RevenueSchedulePage> {
    return this.revenue.schedules(inCompany(access), query);
  }

  @Get('schedules/:id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('recognition.read')
  @SerializeOptions({ schema: revenueScheduleDetailSchema })
  @ApiOkResponse({
    description: 'The schedule, its movements with their entries and its months',
    standardSchema: revenueScheduleDetailSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND')
  async schedule(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<RevenueScheduleDetail> {
    return this.revenue.schedule(inCompany(access), params.id);
  }

  @Get('months')
  @ApiQueryFrom(revenueMonthsQuerySchema)
  @CompanyRoute('recognition.read')
  @SerializeOptions({ schema: revenueMonthSchema })
  @ApiOkResponse({
    description: 'Each month’s releases, what is missing and the decisions held',
    standardSchema: z.array(revenueMonthSchema),
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async months(
    @Access() access: RequestAccess,
    @Query({ schema: revenueMonthsQuerySchema }) query: RevenueMonthsQuery,
  ): Promise<RevenueMonth[]> {
    return this.revenue.months(inCompany(access), query);
  }

  @Get('preview')
  @ApiQueryFrom(revenuePreviewQuerySchema)
  @CompanyRoute('recognition.read')
  @SerializeOptions({ schema: revenuePreviewSchema })
  @ApiOkResponse({
    description: 'The releases the month’s job would post',
    standardSchema: revenuePreviewSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async preview(
    @Access() access: RequestAccess,
    @Query({ schema: revenuePreviewQuerySchema }) query: RevenuePreviewQuery,
  ): Promise<RevenuePreview> {
    return this.revenue.preview(inCompany(access), query.month);
  }
}
