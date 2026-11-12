import { Inject, Injectable } from '@nestjs/common';
import type {
  ReconciliationDay,
  ReconciliationMonth,
  ReconciliationMonthQuery,
} from '@vertex-mizan/contracts';
import {
  type Database,
  readReconciliationDay,
  readReconciliationMonth,
  withCompany,
} from '@vertex-mizan/db';
import type { CompanyRouteAccess } from '../../core/access/access.js';
import { nowInDamascus, todayInDamascus } from '../../core/clock/today.js';
import { DATABASE } from '../../core/database/database.module.js';

/**
 * `/api/reconciliation` (S08 "API"): the days of a month and a day in full, computed on read
 * through `packages/db`'s reconciliation service in the company's context, with now in Damascus.
 * Reads are not audited (S01 rule 24).
 */
@Injectable()
export class ReconciliationService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `GET /api/reconciliation/days?month=&client=`. */
  month(access: CompanyRouteAccess, query: ReconciliationMonthQuery): Promise<ReconciliationMonth> {
    const now = new Date();
    return withCompany(this.db, access.company.id, (tx) =>
      readReconciliationMonth(tx, {
        month: query.month,
        clientId: query.client,
        today: todayInDamascus(now),
        now: nowInDamascus(now),
      }),
    );
  }

  /** `GET /api/reconciliation/days/:date?client=`. */
  day(
    access: CompanyRouteAccess,
    date: string,
    clientId: string | undefined,
  ): Promise<ReconciliationDay> {
    return withCompany(this.db, access.company.id, (tx) =>
      readReconciliationDay(tx, { date, clientId, now: nowInDamascus() }),
    );
  }
}
