import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Query,
  SerializeOptions,
  StreamableFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AgeingQuery,
  type AgeingReport,
  ageingQuerySchema,
  ageingReportSchema,
  type CounterpartyStatement,
  type CounterpartyStatementQuery,
  type ChangeDueDate,
  changeDueDateSchema,
  counterpartyParamsSchema,
  counterpartyStatementQuerySchema,
  counterpartyStatementSchema,
  type IdParam,
  idParamSchema,
  type OpenItem,
  type OpenItemAsOfQuery,
  type OpenItemPage,
  type OpenItemQuery,
  openItemPageSchema,
  openItemQueryAsOfSchema,
  openItemQuerySchema,
  openItemSchema,
  type RunningBalances,
  type RunningBalancesQuery,
  runningBalancesQuerySchema,
  runningBalancesSchema,
} from '@vertex-mizan/contracts';
import type { z } from 'zod';
import { Access, CompanyRoute, inCompany, type RequestAccess } from '../../core/access/access.js';
import {
  ApiErrors,
  COMPANY_READ_ERRORS,
  COMPANY_WRITE_ERRORS,
} from '../../core/http/api-errors.js';
import { ApiOkProducesResponse } from '../../core/http/api-files.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import type { ExportFile } from '../chart/chart.service.js';
import { OpenItemsService } from './open-items.service.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const fileOf = (file: ExportFile) =>
  new StreamableFile(file.body, {
    type: file.contentType,
    disposition: `attachment; filename="${file.fileName}"`,
  });

/** `/api/open-items`: the items behind the control accounts and a manual item's due date (S04). */
@ApiTags('open-items')
@Controller('open-items')
export class OpenItemsController {
  constructor(@Inject(OpenItemsService) private readonly items: OpenItemsService) {}

  @Get()
  @ApiQueryFrom(openItemQuerySchema)
  @CompanyRoute('open_items.read')
  @SerializeOptions({ schema: openItemPageSchema })
  @ApiOkResponse({
    description: 'Items at the date, newest first',
    standardSchema: openItemPageSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: openItemQuerySchema }) query: OpenItemQuery,
  ): Promise<OpenItemPage> {
    return this.items.list(inCompany(access), query);
  }

  @Get(':id')
  @ApiParamsFrom(idParamSchema)
  @ApiQueryFrom(openItemQueryAsOfSchema)
  @CompanyRoute('open_items.read')
  @SerializeOptions({ schema: openItemSchema })
  @ApiOkResponse({
    description: 'The item at the date, its movements and due dates',
    standardSchema: openItemSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND')
  async get(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Query({ schema: openItemQueryAsOfSchema }) query: OpenItemAsOfQuery,
  ): Promise<OpenItem> {
    return this.items.get(inCompany(access), params.id, query.asOf);
  }

  @Put(':id/due-date')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('open_items.manage')
  @SerializeOptions({ schema: openItemSchema })
  @ApiOkResponse({
    description: 'The item with its new due date (S04 rule 15)',
    standardSchema: openItemSchema,
  })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'OPEN_ITEM_FROM_HUB')
  async changeDueDate(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: changeDueDateSchema }) body: ChangeDueDate,
  ): Promise<OpenItem> {
    return this.items.changeDueDate(inCompany(access), params.id, body);
  }
}

/** `/api/receivables/ageing`: the receivables ageing as of a date and its export (S04 rule 16). */
@ApiTags('open-items')
@Controller('receivables')
export class ReceivablesController {
  constructor(@Inject(OpenItemsService) private readonly items: OpenItemsService) {}

  @Get('ageing')
  @ApiQueryFrom(ageingQuerySchema)
  @CompanyRoute('open_items.read')
  @SerializeOptions({ schema: ageingReportSchema })
  @ApiOkResponse({ description: 'The ageing by counterparty', standardSchema: ageingReportSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async ageing(
    @Access() access: RequestAccess,
    @Query({ schema: ageingQuerySchema }) query: AgeingQuery,
  ): Promise<AgeingReport> {
    return this.items.ageing(inCompany(access), query);
  }

  @Get('ageing/export')
  @ApiQueryFrom(ageingQuerySchema)
  @CompanyRoute('open_items.read')
  @ApiOkProducesResponse('The ageing as an Excel workbook', [XLSX])
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async ageingExport(
    @Access() access: RequestAccess,
    @Query({ schema: ageingQuerySchema }) query: AgeingQuery,
  ): Promise<StreamableFile> {
    return fileOf(await this.items.ageingExport(inCompany(access), query));
  }
}

/**
 * `/api/running-balances`: the running items of every counterparty, or of one type, debit balances
 * marked (S04 rule 17, S11 rule 6).
 */
@ApiTags('open-items')
@Controller('running-balances')
export class RunningBalancesController {
  constructor(@Inject(OpenItemsService) private readonly items: OpenItemsService) {}

  @Get()
  @ApiQueryFrom(runningBalancesQuerySchema)
  @CompanyRoute('open_items.read')
  @SerializeOptions({ schema: runningBalancesSchema })
  @ApiOkResponse({
    description: 'The running balances at the date',
    standardSchema: runningBalancesSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: runningBalancesQuerySchema }) query: RunningBalancesQuery,
  ): Promise<RunningBalances> {
    return this.items.runningBalances(inCompany(access), query);
  }
}

/**
 * `/api/counterparties/:valueId/statement`: a client's, supplier's or worker's statement and its
 * export (S04 "Reports", S11 rule 6).
 */
@ApiTags('open-items')
@Controller('counterparties')
export class CounterpartiesController {
  constructor(@Inject(OpenItemsService) private readonly items: OpenItemsService) {}

  @Get(':valueId/statement')
  @ApiParamsFrom(counterpartyParamsSchema)
  @ApiQueryFrom(counterpartyStatementQuerySchema)
  @CompanyRoute('open_items.read')
  @SerializeOptions({ schema: counterpartyStatementSchema })
  @ApiOkResponse({
    description: 'The counterparty statement',
    standardSchema: counterpartyStatementSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND')
  async statement(
    @Access() access: RequestAccess,
    @Param({ schema: counterpartyParamsSchema }) params: z.infer<typeof counterpartyParamsSchema>,
    @Query({ schema: counterpartyStatementQuerySchema }) query: CounterpartyStatementQuery,
  ): Promise<CounterpartyStatement> {
    return this.items.statement(inCompany(access), params.valueId, query);
  }

  @Get(':valueId/statement/export')
  @ApiParamsFrom(counterpartyParamsSchema)
  @ApiQueryFrom(counterpartyStatementQuerySchema)
  @CompanyRoute('open_items.read')
  @ApiOkProducesResponse('The counterparty statement as an Excel workbook', [XLSX])
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND')
  async statementExport(
    @Access() access: RequestAccess,
    @Param({ schema: counterpartyParamsSchema }) params: z.infer<typeof counterpartyParamsSchema>,
    @Query({ schema: counterpartyStatementQuerySchema }) query: CounterpartyStatementQuery,
  ): Promise<StreamableFile> {
    return fileOf(await this.items.statementExport(inCompany(access), params.valueId, query));
  }
}
