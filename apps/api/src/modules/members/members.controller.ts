import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  SerializeOptions,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type IdParam,
  idParamSchema,
  type Member,
  memberSchema,
  type Reason,
  reasonSchema,
  type UpdateMember,
  updateMemberSchema,
} from '@vertex-mizan/contracts';
import { z } from 'zod';
import {
  Access,
  CompanyRoute,
  inCompany,
  Reauthenticated,
  type RequestAccess,
} from '../../core/access/access.js';
import { ApiErrors } from '../../core/http/api-errors.js';
import { ApiParamsFrom } from '../../core/http/api-parameters.js';
import { MembersService } from './members.service.js';

const membersSchema = z.array(memberSchema);

@ApiTags('members')
@Controller('members')
export class MembersController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @Get()
  @CompanyRoute('members.read')
  // Nest serializes an array item by item, with the item's schema.
  @SerializeOptions({ schema: memberSchema })
  @ApiOkResponse({ description: 'The active members', standardSchema: membersSchema })
  @ApiErrors('UNAUTHENTICATED', 'TWO_FACTOR_REQUIRED', 'FORBIDDEN', 'COMPANY_NOT_SELECTED')
  async list(@Access() access: RequestAccess): Promise<Member[]> {
    return this.members.list(inCompany(access));
  }

  @Patch(':id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('members.manage')
  @Reauthenticated()
  @SerializeOptions({ schema: memberSchema })
  @ApiOkResponse({ description: 'The changed member', standardSchema: memberSchema })
  @ApiErrors(
    'UNAUTHENTICATED',
    'TWO_FACTOR_REQUIRED',
    'FORBIDDEN',
    'COMPANY_NOT_SELECTED',
    'NOT_FOUND',
    'LAST_OWNER',
    'COMPANY_ARCHIVED',
    'COMPANY_SWITCHED',
    'REAUTHENTICATION_REQUIRED',
    'VALIDATION_FAILED',
  )
  async update(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateMemberSchema }) body: UpdateMember,
  ): Promise<Member> {
    return this.members.update(inCompany(access), params.id, body);
  }

  /** An owner removes a member (`members.manage`, a fresh code), or a member leaves. */
  @Post(':id/remove')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(204)
  @CompanyRoute()
  @ApiNoContentResponse({ description: 'The membership is archived' })
  @ApiErrors(
    'UNAUTHENTICATED',
    'TWO_FACTOR_REQUIRED',
    'FORBIDDEN',
    'COMPANY_NOT_SELECTED',
    'NOT_FOUND',
    'LAST_OWNER',
    'COMPANY_ARCHIVED',
    'COMPANY_SWITCHED',
    'REAUTHENTICATION_REQUIRED',
    'VALIDATION_FAILED',
  )
  async remove(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: reasonSchema }) body: Reason,
  ): Promise<void> {
    await this.members.remove(inCompany(access), params.id, body.reason);
  }

  @Post(':id/reset-two-factor')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(204)
  @CompanyRoute('members.manage')
  @Reauthenticated()
  @ApiNoContentResponse({ description: 'Two-factor removed, sessions ended, the member emailed' })
  @ApiErrors(
    'UNAUTHENTICATED',
    'TWO_FACTOR_REQUIRED',
    'FORBIDDEN',
    'COMPANY_NOT_SELECTED',
    'NOT_FOUND',
    'RESET_NOT_ALLOWED',
    'COMPANY_ARCHIVED',
    'COMPANY_SWITCHED',
    'REAUTHENTICATION_REQUIRED',
    'VALIDATION_FAILED',
  )
  async resetTwoFactor(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: reasonSchema }) body: Reason,
  ): Promise<void> {
    await this.members.resetTwoFactor(inCompany(access), params.id, body.reason);
  }
}
