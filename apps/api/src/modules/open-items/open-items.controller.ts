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
  type ChangeDueDate,
  type ClientFunds,
  type ClientFundsQuery,
  type ClientStatement,
  type ClientStatementQuery,
  changeDueDateSchema,
  clientFundsQuerySchema,
  clientFundsSchema,
  clientParamsSchema,
  clientStatementQuerySchema,
  clientStatementSchema,
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
  @ApiOkResponse({ description: 'The ageing by client', standardSchema: ageingReportSchema })
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

/** `/api/client-funds`: the clients' running items, debit balances marked (S04 rule 17). */
@ApiTags('open-items')
@Controller('client-funds')
export class ClientFundsController {
  constructor(@Inject(OpenItemsService) private readonly items: OpenItemsService) {}

  @Get()
  @ApiQueryFrom(clientFundsQuerySchema)
  @CompanyRoute('open_items.read')
  @SerializeOptions({ schema: clientFundsSchema })
  @ApiOkResponse({ description: 'The client funds at the date', standardSchema: clientFundsSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: clientFundsQuerySchema }) query: ClientFundsQuery,
  ): Promise<ClientFunds> {
    return this.items.clientFunds(inCompany(access), query);
  }
}

/** `/api/clients/:valueId/statement`: a client's statement and its export (S04 "Reports"). */
@ApiTags('open-items')
@Controller('clients')
export class ClientsController {
  constructor(@Inject(OpenItemsService) private readonly items: OpenItemsService) {}

  @Get(':valueId/statement')
  @ApiParamsFrom(clientParamsSchema)
  @ApiQueryFrom(clientStatementQuerySchema)
  @CompanyRoute('open_items.read')
  @SerializeOptions({ schema: clientStatementSchema })
  @ApiOkResponse({ description: 'The client statement', standardSchema: clientStatementSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND')
  async statement(
    @Access() access: RequestAccess,
    @Param({ schema: clientParamsSchema }) params: z.infer<typeof clientParamsSchema>,
    @Query({ schema: clientStatementQuerySchema }) query: ClientStatementQuery,
  ): Promise<ClientStatement> {
    return this.items.statement(inCompany(access), params.valueId, query);
  }

  @Get(':valueId/statement/export')
  @ApiParamsFrom(clientParamsSchema)
  @ApiQueryFrom(clientStatementQuerySchema)
  @CompanyRoute('open_items.read')
  @ApiOkProducesResponse('The client statement as an Excel workbook', [XLSX])
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND')
  async statementExport(
    @Access() access: RequestAccess,
    @Param({ schema: clientParamsSchema }) params: z.infer<typeof clientParamsSchema>,
    @Query({ schema: clientStatementQuerySchema }) query: ClientStatementQuery,
  ): Promise<StreamableFile> {
    return fileOf(await this.items.statementExport(inCompany(access), params.valueId, query));
  }
}
