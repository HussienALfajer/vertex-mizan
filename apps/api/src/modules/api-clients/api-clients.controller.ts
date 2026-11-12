import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type ApiClient,
  type ApiClientKey,
  type ApiClientKeyParams,
  apiClientKeyParamsSchema,
  apiClientKeySchema,
  apiClientSchema,
  type CreateApiClient,
  type CreatedApiClient,
  createApiClientSchema,
  createdApiClientSchema,
  type IdParam,
  idParamSchema,
  type NewApiKey,
  newApiKeySchema,
  type RevokeApiKey,
  revokeApiKeySchema,
  type UpdateApiClient,
  updateApiClientSchema,
} from '@vertex-mizan/contracts';
import { z } from 'zod';
import {
  Access,
  CompanyRoute,
  inCompany,
  Reauthenticated,
  type RequestAccess,
} from '../../core/access/access.js';
import {
  ApiErrors,
  COMPANY_READ_ERRORS,
  COMPANY_WRITE_ERRORS,
} from '../../core/http/api-errors.js';
import { ApiParamsFrom } from '../../core/http/api-parameters.js';
import { ApiClientsService } from './api-clients.service.js';

/**
 * `/api/api-clients` (S05 rules 19–21): the systems that post to the company, their keys and the
 * document types each is the source of. The owner manages them after a fresh code; a key's secret
 * is answered once, at its creation, and never read again.
 */
@ApiTags('api-clients')
@Controller('api-clients')
export class ApiClientsController {
  constructor(@Inject(ApiClientsService) private readonly clients: ApiClientsService) {}

  @Get()
  @CompanyRoute('api_clients.read')
  @SerializeOptions({ schema: apiClientSchema })
  @ApiOkResponse({
    description: 'Clients with their keys (never a secret) and document types',
    standardSchema: z.array(apiClientSchema),
  })
  @ApiErrors(...COMPANY_READ_ERRORS)
  async list(@Access() access: RequestAccess): Promise<ApiClient[]> {
    return this.clients.list(inCompany(access));
  }

  @Post()
  @CompanyRoute('api_clients.manage')
  @Reauthenticated()
  @SerializeOptions({ schema: createdApiClientSchema })
  @ApiCreatedResponse({
    description: 'The client and its first key, whose secret is shown this once',
    standardSchema: createdApiClientSchema,
  })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'REAUTHENTICATION_REQUIRED')
  async create(
    @Access() access: RequestAccess,
    @Body({ schema: createApiClientSchema }) body: CreateApiClient,
  ): Promise<CreatedApiClient> {
    return this.clients.create(inCompany(access), body);
  }

  @Put(':id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('api_clients.manage')
  @Reauthenticated()
  @SerializeOptions({ schema: apiClientSchema })
  @ApiOkResponse({ description: 'The client', standardSchema: apiClientSchema })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'REAUTHENTICATION_REQUIRED',
    'NOT_FOUND',
    'RECONCILIATION_START_LOCKED',
  )
  async update(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateApiClientSchema }) body: UpdateApiClient,
  ): Promise<ApiClient> {
    return this.clients.update(inCompany(access), params.id, body);
  }

  @Post(':id/keys')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('api_clients.manage')
  @Reauthenticated()
  @SerializeOptions({ schema: newApiKeySchema })
  @ApiCreatedResponse({
    description: 'The new key, whose secret is shown this once',
    standardSchema: newApiKeySchema,
  })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'REAUTHENTICATION_REQUIRED', 'NOT_FOUND', 'API_KEY_LIMIT')
  async createKey(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<NewApiKey> {
    return this.clients.createKey(inCompany(access), params.id);
  }

  @Post(':id/keys/:keyId/revoke')
  @HttpCode(200)
  @ApiParamsFrom(apiClientKeyParamsSchema)
  @CompanyRoute('api_clients.manage')
  @Reauthenticated()
  @SerializeOptions({ schema: apiClientKeySchema })
  @ApiOkResponse({ description: 'The key, revoked', standardSchema: apiClientKeySchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'REAUTHENTICATION_REQUIRED', 'NOT_FOUND')
  async revokeKey(
    @Access() access: RequestAccess,
    @Param({ schema: apiClientKeyParamsSchema }) params: ApiClientKeyParams,
    @Body({ schema: revokeApiKeySchema }) body: RevokeApiKey,
  ): Promise<ApiClientKey> {
    return this.clients.revokeKey(inCompany(access), params.id, params.keyId, body.reason);
  }
}
