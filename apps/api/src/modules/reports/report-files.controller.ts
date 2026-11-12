import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Query,
  SerializeOptions,
  StreamableFile,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type IdParam,
  idParamSchema,
  type JournalBookPrint,
  type JournalBookPrintsQuery,
  journalBookPrintSchema,
  journalBookPrintsQuerySchema,
  type ReportExportParams,
  type ReportExportQuery,
  type ReportFile,
  type ReportFileRequest,
  reportExportParamsSchema,
  reportExportQuerySchema,
  reportFileRequestSchema,
  reportFileSchema,
} from '@vertex-mizan/contracts';
import { z } from 'zod';
import {
  Access,
  CompanyRoute,
  inCompany,
  type RequestAccess,
  WhileArchived,
} from '../../core/access/access.js';
import { ApiErrors, COMPANY_READ_ERRORS } from '../../core/http/api-errors.js';
import { ApiOkProducesResponse } from '../../core/http/api-files.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import { ReportFilesService } from './report-files.service.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The exports and files of S09 (rules 28–30, 35–37) under `/api/reports`: Excel at once, PDFs
 * queued for the worker and downloaded through the API by their requester (an official print by
 * every reader of the register), and the journal book's print register. Reads of the books, so an
 * archived company's reports export too (S01 rule 12).
 */
@ApiTags('reports')
@Controller('reports')
export class ReportFilesController {
  constructor(@Inject(ReportFilesService) private readonly files: ReportFilesService) {}

  @Get('files')
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: reportFileSchema })
  @ApiOkResponse({
    description: 'The person’s own PDF files, newest first',
    standardSchema: z.array(reportFileSchema),
  })
  @ApiErrors(...COMPANY_READ_ERRORS)
  async list(@Access() access: RequestAccess): Promise<ReportFile[]> {
    return this.files.list(inCompany(access));
  }

  @Post('files')
  @CompanyRoute('reports.read')
  @WhileArchived()
  @SerializeOptions({ schema: reportFileSchema })
  @ApiCreatedResponse({ description: 'The file, queued', standardSchema: reportFileSchema })
  @ApiErrors(
    ...COMPANY_READ_ERRORS,
    'VALIDATION_FAILED',
    'PERIOD_NOT_CLOSED',
    'RATE_LIMITED',
    'NOT_FOUND',
  )
  async request(
    @Access() access: RequestAccess,
    @Body({ schema: reportFileRequestSchema }) body: ReportFileRequest,
  ): Promise<ReportFile> {
    return this.files.request(inCompany(access), body);
  }

  @Get('files/:id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: reportFileSchema })
  @ApiOkResponse({ description: 'One file and its state', standardSchema: reportFileSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND')
  async one(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<ReportFile> {
    return this.files.one(inCompany(access), params.id);
  }

  @Get('files/:id/download')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('reports.read')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  @ApiOkProducesResponse('The PDF: the requester’s for 24 hours, an official print always', [
    'application/pdf',
  ])
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND', 'LINK_INVALID')
  async download(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<StreamableFile> {
    const file = await this.files.download(inCompany(access), params.id);
    return new StreamableFile(file.stream, {
      type: 'application/pdf',
      length: file.size,
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }

  @Get('journal-book/prints')
  @ApiQueryFrom(journalBookPrintsQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: journalBookPrintSchema })
  @ApiOkResponse({
    description: 'The year’s official prints, newest first, superseded ones marked',
    standardSchema: z.array(journalBookPrintSchema),
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async prints(
    @Access() access: RequestAccess,
    @Query({ schema: journalBookPrintsQuerySchema }) query: JournalBookPrintsQuery,
  ): Promise<JournalBookPrint[]> {
    return this.files.prints(inCompany(access), query.fiscalYear);
  }

  @Get(':report/export')
  @ApiParamsFrom(reportExportParamsSchema)
  @ApiQueryFrom(reportExportQuerySchema)
  @CompanyRoute('reports.read')
  @ApiOkProducesResponse('The report as an Excel workbook', [XLSX])
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND', 'REPORT_TOO_LARGE')
  async excel(
    @Access() access: RequestAccess,
    @Param({ schema: reportExportParamsSchema }) params: ReportExportParams,
    @Query({ schema: reportExportQuerySchema }) query: ReportExportQuery,
  ): Promise<StreamableFile> {
    const file = await this.files.excel(inCompany(access), params.report, query);
    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }
}
