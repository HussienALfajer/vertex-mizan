import type { EventsRetryJob } from '@vertex-mizan/contracts';
import {
  type AuditActor,
  companies,
  type Database,
  mapAppendedTemplateSlots,
  RECOGNITION_SLOTS,
  type RetryTrigger,
  retryFreed,
  SYSTEM_NAME,
  withCompany,
} from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';
import { todayInDamascus } from '../../core/clock/today.js';

/** The system, as the inbox and the audit log record the automatic retries (rule 10). */
export const retryActor = (job: string): AuditActor => ({
  kind: 'system',
  name: SYSTEM_NAME,
  requestId: `job:${job}`,
  ipAddress: null,
  userAgent: null,
});

/**
 * The held events `triggers` free in one company, retried in its context as the app role
 * (`packages/db`'s `retryFreed()`), in one transaction. An archived company is read-only (S01
 * rule 12): nothing posts. The sweep, which runs at the worker's start after a deploy, first maps
 * the template's slots a later spec appended (S06's four), so the events held for want of them post
 * (S06 "Migration and compatibility"). Answers how many events posted.
 */
export async function retryInCompany(
  db: Database,
  job: string,
  companyId: string,
  triggers: EventsRetryJob['triggers'],
): Promise<number> {
  return withCompany(db, companyId, async (tx) => {
    const [company] = await tx
      .select({ archivedAt: companies.archivedAt })
      .from(companies)
      .where(eq(companies.id, companyId))
      .for('share');
    if (!company || company.archivedAt) return 0;
    if (triggers.some((trigger) => trigger.kind === 'sweep')) {
      await mapAppendedTemplateSlots(tx, companyId, RECOGNITION_SLOTS, retryActor(job));
    }
    return retryFreed(tx, triggers as readonly RetryTrigger[], {
      actor: retryActor(job),
      today: todayInDamascus(),
    });
  });
}
