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
  type MaterialQuantities,
  type MaterialQuantitiesExportQuery,
  type MaterialQuantitiesQuery,
  materialQuantitiesExportQuerySchema,
  materialQuantitiesQuerySchema,
  materialQuantitiesSchema,
  type ProjectList,
  type ProjectListQuery,
  type ProjectParams,
  type ProjectReport,
  type ProjectReportExportQuery,
  type ProjectReportQuery,
  projectListQuerySchema,
  projectListSchema,
  projectParamsSchema,
  projectReportExportQuerySchema,
  projectReportQuerySchema,
  projectReportSchema,
} from '@vertex-mizan/contracts';
import { Access, CompanyRoute, inCompany, type RequestAccess } from '../../core/access/access.js';
import { ApiErrors, COMPANY_READ_ERRORS } from '../../core/http/api-errors.js';
import { ApiOkProducesResponse } from '../../core/http/api-files.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import type { ExportFile } from '../chart/chart.service.js';
import { ReportFilesService } from './report-files.service.js';
import { ReportsService } from './reports.service.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const fileOf = (file: ExportFile) =>
  new StreamableFile(file.body, {
    type: file.contentType,
    disposition: `attachment; filename="${file.fileName}"`,
  });

/**
 * `/api/projects` and `/api/projects/:valueId/report` (S12 "Reports"): the projects list and a
 * project's report, read with `reports.read` in one snapshot, and the report's Excel export,
 * audited `export.project_report`. Its PDF is a report file (`POST /api/reports/files`). A value
 * that is not a project, or another company's, is `NOT_FOUND`.
 */
@ApiTags('projects')
@Controller('projects')
export class ProjectReportsController {
  constructor(
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(ReportFilesService) private readonly files: ReportFilesService,
  ) {}

  @Get()
  @ApiQueryFrom(projectListQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: projectListSchema })
  @ApiOkResponse({
    description:
      'Every project with its contract value, billing to date, revenue, direct costs, contribution, retention and advance',
    standardSchema: projectListSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: projectListQuerySchema }) query: ProjectListQuery,
  ): Promise<ProjectList> {
    return this.reports.projects(inCompany(access), query);
  }

  @Get(':valueId/report/export')
  @ApiParamsFrom(projectParamsSchema)
  @ApiQueryFrom(projectReportExportQuerySchema)
  @CompanyRoute('reports.read')
  @ApiOkProducesResponse('The project report as an Excel workbook', [XLSX])
  @ApiErrors(...COMPANY_READ_ERRORS, 'NOT_FOUND', 'VALIDATION_FAILED', 'REPORT_TOO_LARGE')
  async export(
    @Access() access: RequestAccess,
    @Param({ schema: projectParamsSchema }) params: ProjectParams,
    @Query({ schema: projectReportExportQuerySchema }) query: ProjectReportExportQuery,
  ): Promise<StreamableFile> {
    const { format: _format, ...rest } = query;
    return fileOf(
      await this.files.sheetExcel(inCompany(access), 'project_report', {
        contract: params.valueId,
        ...rest,
      }),
    );
  }

  @Get(':valueId/report')
  @ApiParamsFrom(projectParamsSchema)
  @ApiQueryFrom(projectReportQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: projectReportSchema })
  @ApiOkResponse({
    description:
      "A project's summary, costs against its budget, materials, wages, subcontracts and billings",
    standardSchema: projectReportSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'NOT_FOUND', 'VALIDATION_FAILED')
  async report(
    @Access() access: RequestAccess,
    @Param({ schema: projectParamsSchema }) params: ProjectParams,
    @Query({ schema: projectReportQuerySchema }) query: ProjectReportQuery,
  ): Promise<ProjectReport> {
    return this.reports.project(inCompany(access), params.valueId, query);
  }
}

/**
 * `/api/reports/material-quantities` (S12 "Reports"): quantities per project and material, and
 * their Excel export, audited `export.material_quantities`. Declared before the reports' generic
 * `/:report/export`, so its own export route wins.
 */
@ApiTags('reports')
@Controller('reports/material-quantities')
export class MaterialQuantitiesController {
  constructor(
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(ReportFilesService) private readonly files: ReportFilesService,
  ) {}

  @Get()
  @ApiQueryFrom(materialQuantitiesQuerySchema)
  @CompanyRoute('reports.read')
  @SerializeOptions({ schema: materialQuantitiesSchema })
  @ApiOkResponse({
    description:
      "Per project and material: quantities in, out and net, amounts, the average unit cost and the ledger's amount",
    standardSchema: materialQuantitiesSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async quantities(
    @Access() access: RequestAccess,
    @Query({ schema: materialQuantitiesQuerySchema }) query: MaterialQuantitiesQuery,
  ): Promise<MaterialQuantities> {
    return this.reports.materialQuantities(inCompany(access), query);
  }

  @Get('export')
  @ApiQueryFrom(materialQuantitiesExportQuerySchema)
  @CompanyRoute('reports.read')
  @ApiOkProducesResponse('The material quantities as an Excel workbook', [XLSX])
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'REPORT_TOO_LARGE')
  async export(
    @Access() access: RequestAccess,
    @Query({ schema: materialQuantitiesExportQuerySchema }) query: MaterialQuantitiesExportQuery,
  ): Promise<StreamableFile> {
    const { format: _format, ...params } = query;
    return fileOf(await this.files.sheetExcel(inCompany(access), 'material_quantities', params));
  }
}
