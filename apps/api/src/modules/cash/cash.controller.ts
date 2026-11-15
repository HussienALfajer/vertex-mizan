import { Controller, Get, Inject, Param, Query, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CashPosition,
  type CashPositionQuery,
  type CashStatement,
  type CashStatementQuery,
  cashPositionQuerySchema,
  cashPositionSchema,
  cashStatementQuerySchema,
  cashStatementSchema,
  type IdParam,
  idParamSchema,
  type Voucher,
  type VoucherPage,
  type VoucherQuery,
  voucherPageSchema,
  voucherQuerySchema,
  voucherSchema,
} from '@vertex-mizan/contracts';
import { Access, CompanyRoute, inCompany, type RequestAccess } from '../../core/access/access.js';
import { ApiErrors, COMPANY_READ_ERRORS } from '../../core/http/api-errors.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import { CashService } from './cash.service.js';

/** `/api/cash/*` (S11 rules 16–17): the cash position and a cash account's statement. */
@ApiTags('cash')
@Controller('cash')
export class CashController {
  constructor(@Inject(CashService) private readonly cash: CashService) {}

  @Get('accounts')
  @ApiQueryFrom(cashPositionQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: cashPositionSchema })
  @ApiOkResponse({
    description:
      'Every cash account with its balance and carrying amounts at a date, by currency, with totals',
    standardSchema: cashPositionSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async position(
    @Access() access: RequestAccess,
    @Query({ schema: cashPositionQuerySchema }) query: CashPositionQuery,
  ): Promise<CashPosition> {
    return this.cash.position(inCompany(access), query);
  }

  @Get('accounts/:id/statement')
  @ApiParamsFrom(idParamSchema)
  @ApiQueryFrom(cashStatementQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: cashStatementSchema })
  @ApiOkResponse({
    description:
      "A cash account's statement: opening, each line and count with its voucher, closing",
    standardSchema: cashStatementSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'NOT_FOUND', 'VALIDATION_FAILED')
  async statement(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Query({ schema: cashStatementQuerySchema }) query: CashStatementQuery,
  ): Promise<CashStatement> {
    return this.cash.statement(inCompany(access), params.id, query);
  }
}

/** `/api/vouchers` (S11 "API"): the vouchers' register and a voucher with its entry. */
@ApiTags('cash')
@Controller('vouchers')
export class VouchersController {
  constructor(@Inject(CashService) private readonly cash: CashService) {}

  @Get()
  @ApiQueryFrom(voucherQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: voucherPageSchema })
  @ApiOkResponse({
    description: 'Vouchers by date, newest first, 100 a page',
    standardSchema: voucherPageSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: voucherQuerySchema }) query: VoucherQuery,
  ): Promise<VoucherPage> {
    return this.cash.list(inCompany(access), query);
  }

  @Get(':id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: voucherSchema })
  @ApiOkResponse({ description: 'A voucher with its entry', standardSchema: voucherSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'NOT_FOUND')
  async get(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<Voucher> {
    return this.cash.get(inCompany(access), params.id);
  }
}
