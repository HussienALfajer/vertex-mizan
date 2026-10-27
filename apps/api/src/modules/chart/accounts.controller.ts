import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type Account,
  type AccountQuery,
  accountQuerySchema,
  accountSchema,
  type CreateAccount,
  createAccountSchema,
  type IdParam,
  idParamSchema,
  type Reason,
  reasonSchema,
  type UpdateAccount,
  updateAccountSchema,
} from '@vertex-mizan/contracts';
import { z } from 'zod';
import { Access, CompanyRoute, inCompany, type RequestAccess } from '../../core/access/access.js';
import {
  ApiErrors,
  COMPANY_READ_ERRORS,
  COMPANY_WRITE_ERRORS,
} from '../../core/http/api-errors.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import { AccountsService } from './accounts.service.js';

const accountsSchema = z.array(accountSchema);

/** `/api/accounts`: the chart of accounts (S02 rules 2–6). */
@ApiTags('chart')
@Controller('accounts')
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}

  @Get()
  @ApiQueryFrom(accountQuerySchema)
  @CompanyRoute('accounts.read')
  @SerializeOptions({ schema: accountSchema })
  @ApiOkResponse({ description: 'The whole tree in code order', standardSchema: accountsSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: accountQuerySchema }) query: AccountQuery,
  ): Promise<Account[]> {
    return this.accounts.list(inCompany(access), query.includeArchived === 'true');
  }

  @Post()
  @CompanyRoute('accounts.manage')
  @SerializeOptions({ schema: accountSchema })
  @ApiCreatedResponse({ description: 'The new account', standardSchema: accountSchema })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'NOT_FOUND',
    'ACCOUNT_CODE_INVALID',
    'ACCOUNT_CODE_TAKEN',
    'ACCOUNT_NOT_HEADER',
    'ACCOUNT_ARCHIVED',
    'STATEMENT_LINE_INVALID',
  )
  async create(
    @Access() access: RequestAccess,
    @Body({ schema: createAccountSchema }) body: CreateAccount,
  ): Promise<Account> {
    return this.accounts.create(inCompany(access), body);
  }

  @Patch(':id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('accounts.manage')
  @SerializeOptions({ schema: accountSchema })
  @ApiOkResponse({ description: 'The changed account', standardSchema: accountSchema })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'NOT_FOUND',
    'ACCOUNT_CODE_INVALID',
    'ACCOUNT_CODE_TAKEN',
    'ACCOUNT_NOT_HEADER',
    'ACCOUNT_ARCHIVED',
    'ACCOUNT_LOCKED',
    'ACCOUNT_HAS_CHILDREN',
    'ACCOUNT_ROLE_INVALID',
    'STATEMENT_LINE_INVALID',
  )
  async update(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateAccountSchema }) body: UpdateAccount,
  ): Promise<Account> {
    return this.accounts.update(inCompany(access), params.id, body);
  }

  @Post(':id/block')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('accounts.manage')
  @SerializeOptions({ schema: accountSchema })
  @ApiOkResponse({ description: 'The blocked account', standardSchema: accountSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'ACCOUNT_NOT_POSTABLE', 'ACCOUNT_IN_ROLE')
  async block(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: reasonSchema }) body: Reason,
  ): Promise<Account> {
    return this.accounts.block(inCompany(access), params.id, body.reason);
  }

  @Post(':id/unblock')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('accounts.manage')
  @SerializeOptions({ schema: accountSchema })
  @ApiOkResponse({ description: 'The account, open to postings', standardSchema: accountSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND')
  async unblock(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<Account> {
    return this.accounts.unblock(inCompany(access), params.id);
  }

  @Post(':id/archive')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('accounts.manage')
  @SerializeOptions({ schema: accountSchema })
  @ApiOkResponse({ description: 'The archived account', standardSchema: accountSchema })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'NOT_FOUND',
    'ACCOUNT_LOCKED',
    'ACCOUNT_HAS_CHILDREN',
    'ACCOUNT_IN_ROLE',
    'ACCOUNT_HAS_BALANCE',
  )
  async archive(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: reasonSchema }) body: Reason,
  ): Promise<Account> {
    return this.accounts.archive(inCompany(access), params.id, body.reason);
  }

  @Post(':id/restore')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(200)
  @CompanyRoute('accounts.manage')
  @SerializeOptions({ schema: accountSchema })
  @ApiOkResponse({ description: 'The restored account', standardSchema: accountSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'ACCOUNT_ARCHIVED')
  async restore(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: reasonSchema }) body: Reason,
  ): Promise<Account> {
    return this.accounts.restore(inCompany(access), params.id, body.reason);
  }
}
