import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AcceptInvitation,
  acceptInvitationSchema,
  type CreateInvitation,
  createInvitationSchema,
  type IdParam,
  type Invitation,
  type InvitationLookup,
  type InvitationLookupQuery,
  idParamSchema,
  invitationLookupQuerySchema,
  invitationLookupSchema,
  invitationSchema,
  type MyMembership,
  myMembershipSchema,
} from '@vertex-mizan/contracts';
import { z } from 'zod';
import {
  Access,
  CompanyRoute,
  inCompany,
  Public,
  Reauthenticated,
  type RequestAccess,
} from '../../core/access/access.js';
import { ApiErrors } from '../../core/http/api-errors.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import { InvitationsService } from './invitations.service.js';

const invitationsSchema = z.array(invitationSchema);

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(@Inject(InvitationsService) private readonly invitations: InvitationsService) {}

  @Get()
  @CompanyRoute('members.read')
  // Nest serializes an array item by item, with the item's schema.
  @SerializeOptions({ schema: invitationSchema })
  @ApiOkResponse({ description: 'Pending invitations', standardSchema: invitationsSchema })
  @ApiErrors('UNAUTHENTICATED', 'TWO_FACTOR_REQUIRED', 'FORBIDDEN', 'COMPANY_NOT_SELECTED')
  async list(@Access() access: RequestAccess): Promise<Invitation[]> {
    return this.invitations.list(inCompany(access));
  }

  @Post()
  @CompanyRoute('members.manage')
  @Reauthenticated()
  @SerializeOptions({ schema: invitationSchema })
  @ApiCreatedResponse({
    description: 'The invitation; its email is queued',
    standardSchema: invitationSchema,
  })
  @ApiErrors(
    'UNAUTHENTICATED',
    'TWO_FACTOR_REQUIRED',
    'FORBIDDEN',
    'COMPANY_NOT_SELECTED',
    'INVITATION_EXISTS',
    'MEMBERSHIP_EXISTS',
    'COMPANY_ARCHIVED',
    'COMPANY_SWITCHED',
    'REAUTHENTICATION_REQUIRED',
    'VALIDATION_FAILED',
  )
  async create(
    @Access() access: RequestAccess,
    @Body({ schema: createInvitationSchema }) body: CreateInvitation,
  ): Promise<Invitation> {
    return this.invitations.create(inCompany(access), body);
  }

  @Get('lookup')
  @ApiQueryFrom(invitationLookupQuerySchema)
  @Public()
  @SerializeOptions({ schema: invitationLookupSchema })
  @ApiOkResponse({
    description: 'What the link invites to',
    standardSchema: invitationLookupSchema,
  })
  @ApiErrors('LINK_INVALID', 'RATE_LIMITED', 'VALIDATION_FAILED')
  async lookup(
    @Access() access: RequestAccess,
    @Query({ schema: invitationLookupQuerySchema }) query: InvitationLookupQuery,
  ): Promise<InvitationLookup> {
    return this.invitations.lookup(access, query.token);
  }

  @Post('accept')
  @HttpCode(200)
  @Public()
  @SerializeOptions({ schema: myMembershipSchema })
  @ApiOkResponse({ description: 'The new membership', standardSchema: myMembershipSchema })
  @ApiErrors(
    'LINK_INVALID',
    'UNAUTHENTICATED',
    'TWO_FACTOR_REQUIRED',
    'INVITATION_EMAIL_MISMATCH',
    'MEMBERSHIP_EXISTS',
    'RATE_LIMITED',
    'VALIDATION_FAILED',
  )
  async accept(
    @Access() access: RequestAccess,
    @Body({ schema: acceptInvitationSchema }) body: AcceptInvitation,
  ): Promise<MyMembership> {
    return this.invitations.accept(access, body);
  }

  @Post(':id/revoke')
  @ApiParamsFrom(idParamSchema)
  @HttpCode(204)
  @CompanyRoute('members.manage')
  @ApiNoContentResponse({ description: 'Revoked; the link no longer works' })
  @ApiErrors(
    'UNAUTHENTICATED',
    'TWO_FACTOR_REQUIRED',
    'FORBIDDEN',
    'COMPANY_NOT_SELECTED',
    'NOT_FOUND',
    'COMPANY_ARCHIVED',
    'COMPANY_SWITCHED',
    'VALIDATION_FAILED',
  )
  async revoke(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<void> {
    await this.invitations.revoke(inCompany(access), params.id);
  }
}
