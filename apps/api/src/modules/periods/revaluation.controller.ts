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
  type PeriodParam,
  periodParamSchema,
  type RevaluationPost,
  type RevaluationPostResult,
  type RevaluationPreview,
  type RevaluationQuery,
  revaluationPostResultSchema,
  revaluationPostSchema,
  revaluationPreviewSchema,
  revaluationQuerySchema,
} from '@vertex-mizan/contracts';
import { Access, CompanyRoute, inCompany, type RequestAccess } from '../../core/access/access.js';
import {
  ApiErrors,
  COMPANY_READ_ERRORS,
  COMPANY_WRITE_ERRORS,
} from '../../core/http/api-errors.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import { RevaluationService } from './revaluation.service.js';

/** `/api/revaluation/:period` (S07 "API"): a ledger's month-end revaluation, previewed and posted. */
@ApiTags('periods')
@Controller('revaluation')
export class RevaluationController {
  constructor(@Inject(RevaluationService) private readonly revaluation: RevaluationService) {}

  @Get(':period')
  @ApiParamsFrom(periodParamSchema)
  @ApiQueryFrom(revaluationQuerySchema)
  @CompanyRoute('periods.read')
  @SerializeOptions({ schema: revaluationPreviewSchema })
  @ApiOkResponse({
    description:
      'The ledger’s revaluation of the month: closing rates, balances and their differences, the revaluations posted, the state and the fingerprint',
    standardSchema: revaluationPreviewSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'PERIOD_CLOSED')
  async preview(
    @Access() access: RequestAccess,
    @Param({ schema: periodParamSchema }) params: PeriodParam,
    @Query({ schema: revaluationQuerySchema }) query: RevaluationQuery,
  ): Promise<RevaluationPreview> {
    return this.revaluation.preview(inCompany(access), params.period, query.ledger);
  }

  @Post(':period')
  @HttpCode(200)
  @ApiParamsFrom(periodParamSchema)
  @CompanyRoute('revaluation.post')
  @SerializeOptions({ schema: revaluationPostResultSchema })
  @ApiOkResponse({
    description:
      'The revaluation posted with its reversal, the first result of the same preview, or posted: false with nothing to post',
    standardSchema: revaluationPostResultSchema,
  })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'OPENING_NOT_POSTED',
    'PERIOD_CLOSED',
    'PERIOD_NOT_ENDED',
    'RATE_MISSING',
    'REVALUATION_CHANGED',
    'ACCOUNT_ROLE_MISSING',
  )
  async post(
    @Access() access: RequestAccess,
    @Param({ schema: periodParamSchema }) params: PeriodParam,
    @Body({ schema: revaluationPostSchema }) body: RevaluationPost,
  ): Promise<RevaluationPostResult> {
    return this.revaluation.post(inCompany(access), params.period, body);
  }
}
