import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  SerializeOptions,
  StreamableFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CashPosition,
  type CashPositionExportQuery,
  type CashPositionQuery,
  type CashStatement,
  type CashStatementExportQuery,
  type CashStatementQuery,
  cashPositionExportQuerySchema,
  cashPositionQuerySchema,
  cashPositionSchema,
  cashStatementExportQuerySchema,
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
import { ApiOkProducesResponse } from '../../core/http/api-files.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import type { ExportFile } from '../chart/chart.service.js';
import { ReportFilesService } from '../reports/report-files.service.js';
import { CashService } from './cash.service.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const fileOf = (file: ExportFile) =>
  new StreamableFile(file.body, {
    type: file.contentType,
    disposition: `attachment; filename="${file.fileName}"`,
  });

/**
 * `/api/cash/*` (S11 rules 16–17): the cash position and a cash account's statement, and their
 * Excel exports, audited `export.cash_position` and `export.cash_statement`. Their PDFs are report
 * files (`POST /api/reports/files`), queued for the worker as S09's are. Reads of the books, so an
 * archived company's export too (S01 rule 12).
 */
@ApiTags('cash')
@Controller('cash')
export class CashController {
  constructor(
    @Inject(CashService) private readonly cash: CashService,
    @Inject(ReportFilesService) private readonly files: ReportFilesService,
  ) {}

  @Get('accounts/export')
  @ApiQueryFrom(cashPositionExportQuerySchema)
  @CompanyRoute('reports.read')
  @ApiOkProducesResponse('The cash position as an Excel workbook', [XLSX])
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'REPORT_TOO_LARGE')
  async exportPosition(
    @Access() access: RequestAccess,
    @Query({ schema: cashPositionExportQuerySchema }) query: CashPositionExportQuery,
  ): Promise<StreamableFile> {
    const { format: _format, ...params } = query;
    return fileOf(await this.files.sheetExcel(inCompany(access), 'cash_position', params));
  }

  @Get('accounts/:id/statement/export')
  @ApiParamsFrom(idParamSchema)
  @ApiQueryFrom(cashStatementExportQuerySchema)
  @CompanyRoute('reports.read')
  @ApiOkProducesResponse("A cash account's statement as an Excel workbook", [XLSX])
  @ApiErrors(...COMPANY_READ_ERRORS, 'NOT_FOUND', 'VALIDATION_FAILED', 'REPORT_TOO_LARGE')
  async exportStatement(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Query({ schema: cashStatementExportQuerySchema }) query: CashStatementExportQuery,
  ): Promise<StreamableFile> {
    const { format: _format, ...rest } = query;
    return fileOf(
      await this.files.sheetExcel(inCompany(access), 'cash_statement', {
        account: params.id,
        ...rest,
      }),
    );
  }

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
