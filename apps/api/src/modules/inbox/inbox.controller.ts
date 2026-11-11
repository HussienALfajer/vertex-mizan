import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type IdParam,
  type InboxCounts,
  type InboxEventDetail,
  type InboxPage,
  type InboxQuery,
  type InboxReason,
  idParamSchema,
  inboxCountsSchema,
  inboxEventDetailSchema,
  inboxPageSchema,
  inboxQuerySchema,
  inboxReasonSchema,
  type MapPostingRule,
  mapPostingRuleSchema,
  type PostingRule,
  type PostingSlotParam,
  postingRuleSchema,
  postingSlotParamSchema,
  type ResolveEvent,
  resolveEventSchema,
} from '@vertex-mizan/contracts';
import { z } from 'zod';
import { Access, CompanyRoute, inCompany, type RequestAccess } from '../../core/access/access.js';
import {
  ApiErrors,
  COMPANY_READ_ERRORS,
  COMPANY_WRITE_ERRORS,
} from '../../core/http/api-errors.js';
import { ApiParamsFrom, ApiQueryFrom } from '../../core/http/api-parameters.js';
import { InboxService } from './inbox.service.js';
import { PostingRulesService } from './posting-rules.service.js';

/** `/api/inbox` (S05 rules 15–18): the events Hub sent, their holds and the accountant's actions. */
@ApiTags('inbox')
@Controller('inbox')
export class InboxController {
  constructor(@Inject(InboxService) private readonly inbox: InboxService) {}

  @Get()
  @ApiQueryFrom(inboxQuerySchema)
  @CompanyRoute('events.read')
  @SerializeOptions({ schema: inboxPageSchema })
  @ApiOkResponse({ description: 'Events, newest received first', standardSchema: inboxPageSchema })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED')
  async list(
    @Access() access: RequestAccess,
    @Query({ schema: inboxQuerySchema }) query: InboxQuery,
  ): Promise<InboxPage> {
    return this.inbox.list(inCompany(access), query);
  }

  @Get('counts')
  @CompanyRoute('events.read')
  @SerializeOptions({ schema: inboxCountsSchema })
  @ApiOkResponse({
    description: 'Held events, in all and per reason',
    standardSchema: inboxCountsSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS)
  async counts(@Access() access: RequestAccess): Promise<InboxCounts> {
    return this.inbox.counts(inCompany(access));
  }

  @Get(':id')
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('events.read')
  @SerializeOptions({ schema: inboxEventDetailSchema })
  @ApiOkResponse({
    description: 'The event, its payload as received and its history',
    standardSchema: inboxEventDetailSchema,
  })
  @ApiErrors(...COMPANY_READ_ERRORS, 'VALIDATION_FAILED', 'NOT_FOUND')
  async get(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<InboxEventDetail> {
    return this.inbox.get(inCompany(access), params.id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('events.manage')
  @SerializeOptions({ schema: inboxEventDetailSchema })
  @ApiOkResponse({
    description: 'The event after its attempt',
    standardSchema: inboxEventDetailSchema,
  })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'EVENT_NOT_HELD')
  async retry(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
  ): Promise<InboxEventDetail> {
    return this.inbox.retry(inCompany(access), params.id);
  }

  @Post(':id/post-in-open-period')
  @HttpCode(200)
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('events.manage')
  @SerializeOptions({ schema: inboxEventDetailSchema })
  @ApiOkResponse({
    description: 'The event, posted on the first day of the next open period',
    standardSchema: inboxEventDetailSchema,
  })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'EVENT_NOT_HELD', 'EVENT_ACTION_NOT_ALLOWED')
  async move(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: inboxReasonSchema }) body: InboxReason,
  ): Promise<InboxEventDetail> {
    return this.inbox.move(inCompany(access), params.id, body.reason);
  }

  @Post(':id/recognise-in-open-period')
  @HttpCode(200)
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('events.manage')
  @SerializeOptions({ schema: inboxEventDetailSchema })
  @ApiOkResponse({
    description:
      'The event, its closed months’ elapsed parts posted in the first open period after them (S06 rule 16)',
    standardSchema: inboxEventDetailSchema,
  })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'EVENT_NOT_HELD', 'EVENT_ACTION_NOT_ALLOWED')
  async recognise(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: inboxReasonSchema }) body: InboxReason,
  ): Promise<InboxEventDetail> {
    return this.inbox.recognise(inCompany(access), params.id, body.reason);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('events.manage')
  @SerializeOptions({ schema: inboxEventDetailSchema })
  @ApiOkResponse({
    description: 'The event, resolved by the manual entry',
    standardSchema: inboxEventDetailSchema,
  })
  @ApiErrors(
    ...COMPANY_WRITE_ERRORS,
    'NOT_FOUND',
    'EVENT_NOT_HELD',
    'EVENT_ACTION_NOT_ALLOWED',
    'ENTRY_ALREADY_LINKED',
  )
  async resolve(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: resolveEventSchema }) body: ResolveEvent,
  ): Promise<InboxEventDetail> {
    return this.inbox.resolve(inCompany(access), params.id, body.entryId, body.reason);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  @ApiParamsFrom(idParamSchema)
  @CompanyRoute('events.dismiss')
  @SerializeOptions({ schema: inboxEventDetailSchema })
  @ApiOkResponse({ description: 'The event, dismissed', standardSchema: inboxEventDetailSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'EVENT_NOT_HELD')
  async dismiss(
    @Access() access: RequestAccess,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: inboxReasonSchema }) body: InboxReason,
  ): Promise<InboxEventDetail> {
    return this.inbox.dismiss(inCompany(access), params.id, body.reason);
  }
}

/** `/api/posting-rules` (S05 "Mapping slots"): the account each slot of Hub's rules reads. */
@ApiTags('posting-rules')
@Controller('posting-rules')
export class PostingRulesController {
  constructor(@Inject(PostingRulesService) private readonly rules: PostingRulesService) {}

  @Get()
  @CompanyRoute('posting_rules.read')
  @SerializeOptions({ schema: postingRuleSchema })
  @ApiOkResponse({
    description: 'Every slot, a payment method once per currency',
    standardSchema: z.array(postingRuleSchema),
  })
  @ApiErrors(...COMPANY_READ_ERRORS)
  async list(@Access() access: RequestAccess): Promise<PostingRule[]> {
    return this.rules.list(inCompany(access));
  }

  @Put(':slot')
  @ApiParamsFrom(postingSlotParamSchema)
  @CompanyRoute('posting_rules.manage')
  @SerializeOptions({ schema: postingRuleSchema })
  @ApiOkResponse({ description: 'The slot', standardSchema: postingRuleSchema })
  @ApiErrors(...COMPANY_WRITE_ERRORS, 'NOT_FOUND', 'MAPPING_ACCOUNT_INVALID', 'ACCOUNT_HAS_BALANCE')
  async map(
    @Access() access: RequestAccess,
    @Param({ schema: postingSlotParamSchema }) params: PostingSlotParam,
    @Body({ schema: mapPostingRuleSchema }) body: MapPostingRule,
  ): Promise<PostingRule> {
    return this.rules.map(inCompany(access), params.slot, body);
  }
}
