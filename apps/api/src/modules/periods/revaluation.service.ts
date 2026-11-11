import { Inject, Injectable } from '@nestjs/common';
import type {
  Ledger,
  RevaluationPost,
  RevaluationPostResult,
  RevaluationPreview,
} from '@vertex-mizan/contracts';
import { type Database, postRevaluation, previewRevaluation, withCompany } from '@vertex-mizan/db';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { todayInDamascus } from '../../core/clock/today.js';
import { DATABASE } from '../../core/database/database.module.js';

/**
 * `/api/revaluation/:period` (S07 rules 10–18): the preview and the posting through `packages/db`'s
 * revaluation service in the company's context, with today in Damascus. A company's period is
 * always its own: another company's month reads as an empty month of the caller's.
 */
@Injectable()
export class RevaluationService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `GET /api/revaluation/:period?ledger=`: a read, so nothing is audited. */
  preview(access: CompanyRouteAccess, period: string, ledger: Ledger): Promise<RevaluationPreview> {
    return withCompany(this.db, access.company.id, (tx) =>
      previewRevaluation(tx, { period, ledger, today: todayInDamascus() }),
    );
  }

  /**
   * `POST /api/revaluation/:period`: the company row locked for the write (an archived company
   * refused), then the posting, which locks the ledger head and writes its entries, its row and
   * its audit row in this transaction.
   */
  post(
    access: CompanyRouteAccess,
    period: string,
    body: RevaluationPost,
  ): Promise<RevaluationPostResult> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      return postRevaluation(tx, {
        period,
        ledger: body.ledger,
        fingerprint: body.fingerprint,
        today: todayInDamascus(),
        actor: actorOf(access),
      });
    });
  }
}
