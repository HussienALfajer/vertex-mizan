import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AddBulletinHoliday,
  addBulletinHolidaySchema,
  type BulletinHoliday,
  bulletinHolidaySchema,
  type CreateRatePair,
  createRatePairSchema,
  type IdParam,
  idParamSchema,
  type RateCalendar,
  type RateInForce,
  type RateInForceQuery,
  type RatePage,
  type RatePair,
  type RateQuery,
  type RecordedRate,
  type RecordRate,
  rateCalendarSchema,
  rateInForceQuerySchema,
  rateInForceSchema,
  ratePageSchema,
  ratePairSchema,
  rateQuerySchema,
  recordedRateSchema,
  recordRateSchema,
  type UpdateRateCalendar,
  updateRateCalendarSchema,
} from '@vertex-mizan/contracts';
import { z } from 'zod';
import { Access, CompanyRoute, inCompany, type RequestAccess } from '../../core/access/access.js';
import {
  ApiErrors,
  COMPANY_READ_ERRORS,
  COMPANY_WRITE_ERRORS,
} from '../../core/http/api-errors.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import { RatesService } from './rates.service.js';

/** `/api/rates`: the company rate table (S02 rules 14–16). */
@ApiTags('rates')
@Controller('rates')
export class RatesController {
  constructor(@Inject(RatesService) private readonly rates: RatesService) {}

  @Get()
  @ApiQueryFrom(rateQuerySchema)
  @CompanyRoute('rates.read')
  @SerializeOptions({ schema: ratePageSchema })
  @ApiOkResponse({ description: 'Rows, newest recorded first', standardSchema: ratePageSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: rateQuerySchema }) query: RateQuery,
  ): Promise<RatePage> {
    return this.rates.rates(inCompany(access), query);
  }

  @Get('in-force')
  @ApiQueryFrom(rateInForceQuerySchema)
  @CompanyRoute('rates.read')
  @SerializeOptions({ schema: rateInForceSchema })
  @ApiOkResponse({
    description: 'The row or the cross in force on the date',
    standardSchema: rateInForceSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'RATE_MISSING')
  async inForce(
    @Access() access: RequestAccess,
    @Query({ schema: rateInForceQuerySchema }) query: RateInForceQuery,
  ): Promise<RateInForce> {
    return this.rates.inForce(inCompany(access), query);
  }

  @Post()
  @CompanyRoute('rates.manage')
  @SerializeOptions({ schema: recordedRateSchema })
  @ApiCreatedResponse({
    description: 'The row and, for a correction, the row it supersedes',
    standardSchema: recordedRateSchema,
  })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'RATE_ORIENTATION',
    'RATE_UNCHANGED',
    'RATE_REASON_REQUIRED',
    'SYP_BEFORE_REDENOMINATION',
    'INVALID_RATE',
  )
  async record(
    @Access() access: RequestAccess,
    @Body({ schema: recordRateSchema }) body: RecordRate,
  ): Promise<RecordedRate> {
    return this.rates.record(inCompany(access), body);
  }
}

/** `/api/rate-pairs`: the pairs with their one orientation (ADR 0011). */
@ApiTags('rates')
@Controller('rate-pairs')
export class RatePairsController {
  constructor(@Inject(RatesService) private readonly rates: RatesService) {}

  @Get()
  @CompanyRoute('rates.read')
  @SerializeOptions({ schema: ratePairSchema })
  @ApiOkResponse({ description: 'The pairs', standardSchema: z.array(ratePairSchema) })
  @ApiErrors(...COMPANY_READ_ERRORS)
  async list(@Access() access: RequestAccess): Promise<RatePair[]> {
    return this.rates.pairs(inCompany(access));
  }

  @Post()
  @CompanyRoute('rates.manage')
  @SerializeOptions({ schema: ratePairSchema })
  @ApiCreatedResponse({ description: 'The pair', standardSchema: ratePairSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'RATE_ORIENTATION')
  async create(
    @Access() access: RequestAccess,
    @Body({ schema: createRatePairSchema }) body: CreateRatePair,
  ): Promise<RatePair> {
    return this.rates.createPair(inCompany(access), body);
  }
}

/** `/api/rate-calendar`: the bulletin's weekly days off and holidays (S02 rule 17). */
@ApiTags('rates')
@Controller('rate-calendar')
export class RateCalendarController {
  constructor(@Inject(RatesService) private readonly rates: RatesService) {}

  @Get()
  @CompanyRoute('rates.read')
  @SerializeOptions({ schema: rateCalendarSchema })
  @ApiOkResponse({ description: 'Days off and holidays', standardSchema: rateCalendarSchema })
  @ApiErrors(...COMPANY_READ_ERRORS)
  async get(@Access() access: RequestAccess): Promise<RateCalendar> {
    return this.rates.calendar(inCompany(access));
  }

  @Put()
  @CompanyRoute('rates.manage')
  @SerializeOptions({ schema: rateCalendarSchema })
  @ApiOkResponse({
    description: 'The calendar after the change',
    standardSchema: rateCalendarSchema,
  })
  @ApiErrors(...COMPANY_WRITE_ERRORS)
  async update(
    @Access() access: RequestAccess,
    @Body({ schema: updateRateCalendarSchema }) body: UpdateRateCalendar,
  ): Promise<RateCalendar> {
    return this.rates.updateCalendar(inCompany(access), body.daysOff);
  }

  @Post('holidays')
  @CompanyRoute('rates.manage')
  @SerializeOptions({ schema: bulletinHolidaySchema })
  @ApiCreatedResponse({ description: 'The holiday', standardSchema: bulletinHolidaySchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'HOLIDAY_EXISTS')
  async addHoliday(
    @Access() access: RequestAccess,
    @Body({ schema: addBulletinHolidaySchema }) body: AddBulletinHoliday,
  ): Promise<BulletinHoliday> {
    return this.rates.addHoliday(inCompany(access), body);
  }

  @Post('holidays/:id/remove')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('rates.manage')
  @SerializeOptions({ schema: bulletinHolidaySchema })
  @ApiOkResponse({ description: 'The removed holiday', standardSchema: bulletinHolidaySchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND')
  async removeHoliday(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<BulletinHoliday> {
    return this.rates.removeHoliday(inCompany(access), params.id);
  }
}
