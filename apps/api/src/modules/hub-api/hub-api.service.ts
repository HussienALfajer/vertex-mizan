import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  type CurrencyCode,
  checkCurrencyDate,
  DomainError,
  documentOf,
  type EventEnvelope,
  type EventOutcome,
  monthsOf,
  type PeriodStatus,
  type PeriodStatusQuery,
  type ReceivedEventsPage,
  type ReceivedEventsQuery,
  type ReconciliationReport,
  type ReconciliationResult,
} from '@vertex-mizan/contracts';
import {
  companySettings,
  type Database,
  describeForLog,
  documentSources,
  type InboxEventView,
  isClosedPeriod,
  readClosedPeriods,
  readReceivedEvents,
  receiveEvent,
  receiveReconciliationReport,
  withCompany,
} from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';
import { type ApiClientRouteAccess, clientActorOf } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { todayInDamascus } from '../../core/clock/today.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { RetryQueue } from '../../core/jobs/retry-queue.js';

/** An event's answer (rules 4–7): `201` posted or recorded, `202` held. */
export interface Receipt {
  readonly status: 201 | 202;
  readonly outcome: EventOutcome;
}

/** The last day of the month of `day` (`YYYY-MM-DD`). */
function lastDayOfMonth(day: string): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${day.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

/** The currencies an event's payload is in: its own and its invoice's. */
function payloadCurrencies(event: EventEnvelope): CurrencyCode[] {
  const payload = event.payload as Partial<Record<'currency' | 'invoice_currency', CurrencyCode>>;
  return [payload.currency, payload.invoice_currency].filter(
    (currency): currency is CurrencyCode => currency !== undefined,
  );
}

/** A refusal answers as it is; anything else is a failure the transaction may outlive. */
const isRefusal = (error: unknown) =>
  error instanceof DomainError || error instanceof HttpException;

function outcomeOf(event: InboxEventView): Receipt {
  if (event.state === 'held') {
    if (!event.reason) throw new Error('A held event without its reason');
    return {
      status: 202,
      outcome: {
        status: 'held',
        inbox_id: event.inboxId,
        reason: event.reason,
        detail: event.detail as Extract<EventOutcome, { status: 'held' }>['detail'],
      },
    };
  }
  return {
    status: 201,
    outcome: {
      status: event.state,
      inbox_id: event.inboxId,
      entries: event.entries.map((entry) => ({
        id: entry.id,
        fiscal_year: entry.fiscalYear,
        number: entry.number,
      })),
    },
  };
}

/**
 * Hub's API (S05 rules 1–7, "Periods"): an event received, stored and attempted in one
 * transaction in the key's company, its refusals storing nothing; and the periods' states.
 */
@Injectable()
export class HubApiService {
  private readonly logger = new Logger('HubApi');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(RetryQueue) private readonly retries: RetryQueue,
  ) {}

  /**
   * `POST /v1/events`. Before anything is stored: the `Idempotency-Key` equal to the event's ID,
   * an accounting date no later than the current month in Damascus (`ENTRY_DATE_OUT_OF_RANGE`),
   * no SYP before the new pound (`SYP_BEFORE_REDENOMINATION`, edge case 18), and the client the
   * source of the event's document type (`SOURCE_NOT_ALLOWED`, rule 21). A failure that is no
   * refusal (a deadlock, a lost connection) runs the transaction once more, then answers `503`
   * with nothing stored, so Hub's retry is safe (rule 5). The retries the event frees are queued
   * after the commit.
   */
  async receive(
    access: ApiClientRouteAccess,
    idempotencyKey: string | undefined,
    raw: Record<string, unknown>,
    envelope: EventEnvelope,
  ): Promise<Receipt> {
    if (idempotencyKey !== envelope.id) {
      throw new CodedException('VALIDATION_FAILED', 'Idempotency-Key must equal the event id', [
        { path: ['Idempotency-Key'], message: 'Must equal the event id' },
      ]);
    }
    const today = todayInDamascus();
    if (envelope.accounting_date > lastDayOfMonth(today)) {
      throw new CodedException(
        'ENTRY_DATE_OUT_OF_RANGE',
        'The accounting date is after the current month',
      );
    }
    for (const currency of payloadCurrencies(envelope)) {
      checkCurrencyDate(currency, envelope.accounting_date);
    }
    const companyId = access.client.companyId;
    const attempt = () =>
      withCompany(this.db, companyId, async (tx) => {
        await lockCompanyForWrite(tx, companyId);
        // The book and parallel ledgers are in SYP for a Syrian company: no SYP before 2026.
        const [settings] = await tx
          .select({
            book: companySettings.bookCurrency,
            parallel: companySettings.parallelCurrency,
          })
          .from(companySettings);
        for (const currency of [settings?.book, settings?.parallel]) {
          if (currency) checkCurrencyDate(currency as CurrencyCode, envelope.accounting_date);
        }
        const document = documentOf(envelope);
        const [source] = await tx
          .select({ clientId: documentSources.apiClientId, archivedAt: documentSources.archivedAt })
          .from(documentSources)
          .where(eq(documentSources.documentType, document.type));
        if (!source || source.archivedAt || source.clientId !== access.client.id) {
          throw new CodedException(
            'SOURCE_NOT_ALLOWED',
            'The document type comes from another source',
            undefined,
            { documentType: document.type },
          );
        }
        return receiveEvent(
          tx,
          companyId,
          { raw, envelope, apiClientId: access.client.id, requestId: access.requestId },
          { actor: clientActorOf(access), today },
        );
      });
    const result = await attempt().catch((first: unknown) => {
      if (isRefusal(first)) throw first;
      this.logger.warn(`An event's transaction failed, once more: ${describeForLog(first)}`);
      return attempt().catch((second: unknown) => {
        if (isRefusal(second)) throw second;
        this.logger.error(`An event's transaction failed twice: ${describeForLog(second)}`);
        throw new ServiceUnavailableException('The event was not stored; send it again');
      });
    });
    await this.retries.afterCommit(companyId, result.triggers);
    return outcomeOf(result.event);
  }

  /**
   * `GET /v1/periods/status` (S05 "Periods", S07 rules 1 and 4): each month of the range, `closed`
   * when it is closed or before the company's first period while a month is closed, `open`
   * otherwise (a reopened month, or one with no period row yet); Hub calls it before a past-dated
   * change.
   */
  async periodStatus(
    access: ApiClientRouteAccess,
    query: PeriodStatusQuery,
  ): Promise<PeriodStatus[]> {
    const view = await withCompany(this.db, access.client.companyId, (tx) => readClosedPeriods(tx));
    return monthsOf(query).map((period) => ({
      period,
      state: isClosedPeriod(view, period) ? 'closed' : 'open',
    }));
  }

  /**
   * `POST /v1/reconciliation/daily` (S08 rules 1, 4, 5): the `Idempotency-Key` equal to the
   * report's id, then the report kept and compared in the key's company, the company row locked
   * for the write (an archived company refused). It takes no ledger lock, so it never waits for a
   * close: a close's checklist reads each report whole or not at all, and a report committed after
   * the close shows "بعد الإقفال" on its days (rules 12, 15). `201` stored, `200` a replay that
   * stores nothing.
   */
  async reconcile(
    access: ApiClientRouteAccess,
    idempotencyKey: string | undefined,
    raw: Record<string, unknown>,
    report: ReconciliationReport,
  ): Promise<{ status: 200 | 201; result: ReconciliationResult }> {
    if (idempotencyKey !== report.id) {
      throw new CodedException('VALIDATION_FAILED', 'Idempotency-Key must equal the report id', [
        { path: ['Idempotency-Key'], message: 'Must equal the report id' },
      ]);
    }
    const companyId = access.client.companyId;
    const { result, replayed } = await withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      return receiveReconciliationReport(tx, companyId, {
        raw,
        report,
        apiClientId: access.client.id,
        requestId: access.requestId,
        today: todayInDamascus(),
      });
    });
    return { status: replayed ? 200 : 201, result };
  }

  /** `GET /v1/events?date=` (S08 rule 14): the calling client's events only. */
  receivedEvents(
    access: ApiClientRouteAccess,
    query: ReceivedEventsQuery,
  ): Promise<ReceivedEventsPage> {
    return withCompany(this.db, access.client.companyId, (tx) =>
      readReceivedEvents(tx, {
        apiClientId: access.client.id,
        date: query.date,
        cursor: query.cursor,
      }),
    );
  }
}
