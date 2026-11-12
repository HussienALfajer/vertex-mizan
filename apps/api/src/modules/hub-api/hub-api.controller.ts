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
  type OpeningSnapshot,
  type OpeningSnapshotResult,
  openingSnapshotResultSchema,
  openingSnapshotSchema,
  type PeriodStatus,
  type PeriodStatusQuery,
  periodStatusQuerySchema,
  periodStatusSchema,
  type ReceivedEventsPage,
  type ReceivedEventsQuery,
  type ReconciliationReport,
  type ReconciliationResult,
  receivedEventsPageSchema,
  receivedEventsQuerySchema,
  reconciliationReportSchema,
  reconciliationResultSchema,
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
  @ApiServiceUnavailableResponse({
    description:
      'Nothing stored: send the event again. OPENING_NOT_POSTED, with Retry-After, before the opening posts (S10)',
  })
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

  @Post('opening/snapshot')
  @ApiClientRoute('opening:write')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: "The snapshot's key" })
  @SerializeOptions({ schema: openingSnapshotResultSchema })
  @ApiCreatedResponse({
    description: 'The snapshot stored, with what Mizan read in it: its counts and totals',
    standardSchema: openingSnapshotResultSchema,
  })
  @ApiOkResponse({
    description: 'A replay of the same key and body: the first answer, nothing stored',
    standardSchema: openingSnapshotResultSchema,
  })
  @ApiErrors(
    ...CLIENT_ERRORS,
    'VALIDATION_FAILED',
    'IDEMPOTENCY_CONFLICT',
    'OPENING_POSTED',
    'NO_BOOKS_START',
  )
  async receiveSnapshot(
    @Access() access: RequestAccess,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body({ schema: openingSnapshotSchema }) snapshot: OpeningSnapshot,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OpeningSnapshotResult> {
    const { status, result } = await this.hub.receiveSnapshot(
      viaApiClient(access),
      idempotencyKey,
      snapshot,
    );
    response.status(status);
    return result;
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

  @Post('reconciliation/daily')
  @ApiClientRoute('reconciliation:write')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'The report id' })
  @SerializeOptions({ schema: reconciliationResultSchema })
  @ApiCreatedResponse({
    description:
      'The report kept, and the date’s comparison now by its latest report: its gaps and totals',
    standardSchema: reconciliationResultSchema,
  })
  @ApiOkResponse({
    description: 'A replay: nothing stored, the date’s comparison now',
    standardSchema: reconciliationResultSchema,
  })
  @ApiErrors(...CLIENT_ERRORS, 'VALIDATION_FAILED', 'IDEMPOTENCY_CONFLICT')
  async reconcile(
    @Access() access: RequestAccess,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Body({ schema: reconciliationReportSchema }) report: ReconciliationReport,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReconciliationResult> {
    // The body as Hub sent it, kept and hashed, beside its parsed report.
    const raw = request.body as Record<string, unknown>;
    const { status, result } = await this.hub.reconcile(
      viaApiClient(access),
      idempotencyKey,
      raw,
      report,
    );
    response.status(status);
    return result;
  }

  @Get('events')
  @ApiQueryFrom(receivedEventsQuerySchema)
  @ApiClientRoute('reconciliation:write')
  @SerializeOptions({ schema: receivedEventsPageSchema })
  @ApiOkResponse({
    description:
      'The events Mizan received from this client with that accounting date, in received order, 500 a page',
    standardSchema: receivedEventsPageSchema,
  })
  @ApiErrors(...CLIENT_ERRORS, 'VALIDATION_FAILED')
  receivedEvents(
    @Access() access: RequestAccess,
    @Query({ schema: receivedEventsQuerySchema }) query: ReceivedEventsQuery,
  ): Promise<ReceivedEventsPage> {
    return this.hub.receivedEvents(viaApiClient(access), query);
  }
}
