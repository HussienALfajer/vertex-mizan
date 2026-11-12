import { Inject, Injectable } from '@nestjs/common';
import type {
  PeriodDetail,
  PeriodReopenResult,
  PeriodSummary,
  PeriodsQuery,
} from '@vertex-mizan/contracts';
import {
  closePeriod,
  type Database,
  readPeriod,
  readPeriods,
  reopenPeriod,
  withCompany,
} from '@vertex-mizan/db';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { todayInDamascus } from '../../core/clock/today.js';
import { DATABASE } from '../../core/database/database.module.js';
import { RetryQueue } from '../../core/jobs/retry-queue.js';

/**
 * `/api/periods` (S07 rules 1–9): the months with their states, a month's history and checklist,
 * and its close and reopen, through `packages/db`'s period service in the company's context with
 * today in Damascus. Another company's month reads as an empty month of the caller's.
 */
@Injectable()
export class PeriodsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(RetryQueue) private readonly retries: RetryQueue,
  ) {}

  /** `GET /api/periods?from=&to=`: a read, so nothing is audited. */
  list(access: CompanyRouteAccess, query: PeriodsQuery): Promise<PeriodSummary[]> {
    return withCompany(this.db, access.company.id, (tx) =>
      readPeriods(tx, { from: query.from, to: query.to, today: todayInDamascus() }),
    );
  }

  /** `GET /api/periods/:period`: the month, its history and its checklist. */
  read(access: CompanyRouteAccess, period: string): Promise<PeriodDetail> {
    return withCompany(this.db, access.company.id, (tx) =>
      readPeriod(tx, period, todayInDamascus()),
    );
  }

  /**
   * `POST /api/periods/:period/close`: the company row locked for the write (an archived company
   * refused), then the close, which locks the ledger head and the period and writes the period's
   * event and its audit row in this transaction.
   */
  close(access: CompanyRouteAccess, period: string, reason: string): Promise<PeriodDetail> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      return closePeriod(tx, { period, reason, today: todayInDamascus(), actor: actorOf(access) });
    });
  }

  /**
   * `POST /api/periods/:period/reopen`: as the close, then, after the commit, the events held for
   * the month queued for retry (S07 rule 6), which the worker's `events.retry` posts.
   */
  async reopen(
    access: CompanyRouteAccess,
    period: string,
    reason: string,
  ): Promise<PeriodReopenResult> {
    const companyId = access.company.id;
    const reopened = await withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      return reopenPeriod(tx, { period, reason, today: todayInDamascus(), actor: actorOf(access) });
    });
    await this.retries.afterCommit(companyId, reopened.triggers);
    return { period: reopened.period, queuedEvents: reopened.queuedEvents };
  }
}
