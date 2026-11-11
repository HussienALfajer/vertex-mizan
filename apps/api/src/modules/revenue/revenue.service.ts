import { Inject, Injectable } from '@nestjs/common';
import {
  monthsOf,
  type RevenueMonth,
  type RevenueMonthsQuery,
  type RevenuePreview,
  type RevenueScheduleDetail,
  type RevenueSchedulePage,
  type RevenueScheduleQuery,
} from '@vertex-mizan/contracts';
import {
  type Database,
  previewRevenueMonth,
  readRevenueMonths,
  readRevenueSchedule,
  readRevenueSchedules,
  withCompany,
} from '@vertex-mizan/db';
import type { CompanyRouteAccess } from '../../core/access/access.js';
import { todayInDamascus } from '../../core/clock/today.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { decodeCursor, encodeCursor } from '../../core/http/cursor.js';

/**
 * `/api/revenue` (S06 "API"): the recognition schedules, a schedule with its movements and months,
 * the months' releases and the current month's preview, read through `packages/db`'s revenue reads
 * in the company's context. Reads only, so nothing is audited.
 */
@Injectable()
export class RevenueService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `GET /api/revenue/schedules`: newest first, by state, client, contract and month. */
  async schedules(
    access: CompanyRouteAccess,
    query: RevenueScheduleQuery,
  ): Promise<RevenueSchedulePage> {
    const after = query.cursor === undefined ? null : decodeCursor(query.cursor).id;
    const { cursor: _cursor, ...filter } = query;
    return withCompany(this.db, access.company.id, async (tx) => {
      const page = await readRevenueSchedules(tx, filter, after);
      const last = page.schedules.at(-1);
      return {
        schedules: page.schedules,
        nextCursor:
          page.more && last
            ? encodeCursor({ id: last.id, createdAt: new Date(last.createdAt) })
            : null,
      };
    });
  }

  /** `GET /api/revenue/schedules/:id`: `NOT_FOUND` for none, or another company's. */
  async schedule(access: CompanyRouteAccess, id: string): Promise<RevenueScheduleDetail> {
    const schedule = await withCompany(this.db, access.company.id, (tx) =>
      readRevenueSchedule(tx, id),
    );
    if (schedule === null) throw new CodedException('NOT_FOUND', 'No such schedule');
    return schedule;
  }

  /** `GET /api/revenue/months`: each month of the range, at most 24. */
  months(access: CompanyRouteAccess, query: RevenueMonthsQuery): Promise<RevenueMonth[]> {
    return withCompany(this.db, access.company.id, (tx) =>
      readRevenueMonths(tx, monthsOf(query), todayInDamascus()),
    );
  }

  /** `GET /api/revenue/preview`: the releases the job would post for the month. */
  preview(access: CompanyRouteAccess, month: string): Promise<RevenuePreview> {
    return withCompany(this.db, access.company.id, (tx) =>
      previewRevenueMonth(tx, month, todayInDamascus()),
    );
  }
}
