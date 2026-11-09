import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Query,
  Req,
  Res,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  type EventEnvelope,
  type EventOutcome,
  eventEnvelopeSchema,
  eventOutcomeSchema,
  type PeriodStatus,
  type PeriodStatusQuery,
  periodStatusQuerySchema,
  periodStatusSchema,
} from '@vertex-mizan/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  Access,
  ApiClientRoute,
  type RequestAccess,
  viaApiClient,
} from '../../core/access/access.js';
import { ApiErrors } from '../../core/http/api-errors.js';
import { ApiQueryFrom } from '../../core/http/api-parameters.js';
import { HubApiService } from './hub-api.service.js';

/** What the key's guard answers on every `/v1` route (S05 "Access", rules 19–22). */
const CLIENT_ERRORS = ['UNAUTHENTICATED', 'FORBIDDEN', 'COMPANY_ARCHIVED', 'RATE_LIMITED'] as const;

/**
 * Hub's API under `/v1` (ADR 0006, ADR 0014): additive only from now on. Every answer carries
 * `X-Request-Id`; a client accepts a status, reason or detail it does not know.
 */
@ApiTags('v1')
@ApiBearerAuth()
@Controller('v1')
export class HubApiController {
  constructor(@Inject(HubApiService) private readonly hub: HubApiService) {}

  @Post('events')
  @ApiClientRoute('events:write')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'The event id' })
  @SerializeOptions({ schema: eventOutcomeSchema })
  @ApiCreatedResponse({
    description: 'Posted or recorded, with its entries; a replay answers the current state',
    standardSchema: eventOutcomeSchema,
  })
  @ApiAcceptedResponse({
    description: 'Held, with its reason and detail; it posts later from the inbox',
    standardSchema: eventOutcomeSchema,
  })
  @ApiServiceUnavailableResponse({ description: 'Nothing stored: send the event again' })
  @ApiErrors(
    ...CLIENT_ERRORS,
    'VALIDATION_FAILED',
    'ENTRY_DATE_OUT_OF_RANGE',
    'SYP_BEFORE_REDENOMINATION',
    'IDEMPOTENCY_CONFLICT',
    'SOURCE_NOT_ALLOWED',
  )
  async receive(
    @Access() access: RequestAccess,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Body({ schema: eventEnvelopeSchema }) envelope: EventEnvelope,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EventOutcome> {
    // The body as Hub sent it, which the inbox keeps and hashes, beside its parsed envelope.
    const raw = request.body as Record<string, unknown>;
    const { status, outcome } = await this.hub.receive(
      viaApiClient(access),
      idempotencyKey,
      raw,
      envelope,
    );
    response.status(status);
    return outcome;
  }

  @Get('periods/status')
  @ApiQueryFrom(periodStatusQuerySchema)
  @ApiClientRoute('periods:read')
  @SerializeOptions({ schema: periodStatusSchema })
  @ApiOkResponse({
    description: 'Each month of the range, open or closed',
    standardSchema: z.array(periodStatusSchema),
  })
  @ApiErrors(...CLIENT_ERRORS, 'VALIDATION_FAILED')
  async periodStatus(
    @Access() access: RequestAccess,
    @Query({ schema: periodStatusQuerySchema }) query: PeriodStatusQuery,
  ): Promise<PeriodStatus[]> {
    return this.hub.periodStatus(viaApiClient(access), query);
  }
}
