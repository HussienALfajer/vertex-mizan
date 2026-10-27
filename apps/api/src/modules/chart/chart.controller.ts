import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Query,
  SerializeOptions,
  StreamableFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type Account,
  type AccountRoleAssignment,
  type ApplyChartTemplate,
  accountRoleAssignmentSchema,
  accountSchema,
  applyChartTemplateSchema,
  type ChartExportQuery,
  type ChartTemplateSummary,
  chartExportQuerySchema,
  chartTemplateSummarySchema,
  type SetAccountRole,
  STATEMENT_LINES,
  type StatementLine,
  setAccountRoleSchema,
  statementLineSchema,
} from '@vertex-mizan/contracts';
import { z } from 'zod';
import { Access, CompanyRoute, inCompany, type RequestAccess } from '../../core/access/access.js';
import {
  ApiErrors,
  COMPANY_READ_ERRORS,
  COMPANY_WRITE_ERRORS,
} from '../../core/http/api-errors.js';
import { ApiOkProducesResponse } from '../../core/http/api-files.js';
import { ApiQueryFrom } from '../../core/http/api-parameters.js';
import { AccountsService } from './accounts.service.js';
import { ChartService } from './chart.service.js';

/** `/api/chart`: the templates, the statement-line catalogue and the export (S02). */
@ApiTags('chart')
@Controller('chart')
export class ChartController {
  constructor(@Inject(ChartService) private readonly chart: ChartService) {}

  @Get('templates')
  @CompanyRoute('accounts.read')
  @SerializeOptions({ schema: chartTemplateSummarySchema })
  @ApiOkResponse({
    description: 'The chart templates',
    standardSchema: z.array(chartTemplateSummarySchema),
  })
  @ApiErrors(...COMPANY_READ_ERRORS)
  templates(): ChartTemplateSummary[] {
    return this.chart.templates();
  }

  @Post('apply-template')
  @HttpCode(200)
  @CompanyRoute('accounts.manage')
  @SerializeOptions({ schema: accountSchema })
  @ApiOkResponse({ description: 'The tree', standardSchema: z.array(accountSchema) })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'CHART_NOT_EMPTY')
  async applyTemplate(
    @Access() access: RequestAccess,
    @Body({ schema: applyChartTemplateSchema }) body: ApplyChartTemplate,
  ): Promise<Account[]> {
    return this.chart.applyTemplate(inCompany(access), body.templateId);
  }

  @Get('statement-lines')
  @CompanyRoute('accounts.read')
  @SerializeOptions({ schema: statementLineSchema })
  @ApiOkResponse({
    description: 'The statement-line catalogue',
    standardSchema: z.array(statementLineSchema),
  })
  @ApiErrors(...COMPANY_READ_ERRORS)
  statementLines(): readonly StatementLine[] {
    return STATEMENT_LINES;
  }

  @Get('export')
  @ApiQueryFrom(chartExportQuerySchema)
  @CompanyRoute('accounts.read')
  @ApiOkProducesResponse('The chart as an Excel workbook', [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ])
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async export(
    @Access() access: RequestAccess,
    @Query({ schema: chartExportQuerySchema }) _query: ChartExportQuery,
  ): Promise<StreamableFile> {
    const file = await this.chart.export(inCompany(access));
    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }
}

/** `/api/account-roles`: the six account roles (S02 rule 7). */
@ApiTags('chart')
@Controller('account-roles')
export class AccountRolesController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}

  @Get()
  @CompanyRoute('accounts.read')
  @SerializeOptions({ schema: accountRoleAssignmentSchema })
  @ApiOkResponse({
    description: 'Each role with its account, null when not set',
    standardSchema: z.array(accountRoleAssignmentSchema),
  })
  @ApiErrors(...COMPANY_READ_ERRORS)
  async list(@Access() access: RequestAccess): Promise<AccountRoleAssignment[]> {
    return this.accounts.roles(inCompany(access));
  }

  @Put()
  @CompanyRoute('accounts.manage')
  @SerializeOptions({ schema: accountRoleAssignmentSchema })
  @ApiOkResponse({
    description: 'The six roles after the change',
    standardSchema: z.array(accountRoleAssignmentSchema),
  })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'ACCOUNT_ROLE_INVALID')
  async set(
    @Access() access: RequestAccess,
    @Body({ schema: setAccountRoleSchema }) body: SetAccountRole,
  ): Promise<AccountRoleAssignment[]> {
    return this.accounts.setRole(inCompany(access), body);
  }
}
