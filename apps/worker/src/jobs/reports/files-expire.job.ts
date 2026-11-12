import { Inject, Injectable, Logger } from '@nestjs/common';
import { REPORT_FILE_LOST_AFTER_HOURS } from '@vertex-mizan/contracts';
import { type Database, reportFiles, withCompany } from '@vertex-mizan/db';
import { and, eq, lte, or, sql } from 'drizzle-orm';
import { DATABASE, JOBS_DATABASE } from '../../core/database/database.module.js';
import { FileStore } from '../../core/files/file-store.js';
import type { ScheduledJob } from '../../core/queue/scheduled-job.js';

const due = and(eq(reportFiles.state, 'ready'), lte(reportFiles.expiresAt, sql`now()`));

const lost = and(
  eq(reportFiles.state, 'queued'),
  lte(
    reportFiles.createdAt,
    sql`now() - ${sql.raw(`interval '${REPORT_FILE_LOST_AFTER_HOURS} hours'`)}`,
  ),
);

/**
 * The end of a PDF's 24 hours (S09 rule 36, "Jobs and events"), hourly: the jobs role finds the
 * ready files past their time across companies (an official print has none, so it is kept), and
 * the files still queued an hour after they were asked, whose job the queue lost; in each
 * company's context a file past its time is deleted and its row marked `expired`, keeping its size
 * and digest, and a lost one marked `failed` (`RENDER_LOST`), so it no longer counts against its
 * person's three. A second run finds nothing; a file already gone is no error.
 */
@Injectable()
export class ReportsFilesExpireJob implements ScheduledJob {
  readonly queue = 'reports.files-expire';
  readonly cron = '20 * * * *';
  private readonly logger = new Logger(ReportsFilesExpireJob.name);

  constructor(
    @Inject(JOBS_DATABASE) private readonly jobs: Database,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FileStore) private readonly files: FileStore,
  ) {}

  async run(): Promise<{ expired: number; lost: number }> {
    const found = await this.jobs
      .select({ companyId: reportFiles.companyId, id: reportFiles.id, state: reportFiles.state })
      .from(reportFiles)
      .where(or(due, lost));
    let expired = 0;
    let failed = 0;
    for (const { companyId, id, state } of found) {
      const done = await withCompany(this.db, companyId, async (tx) => {
        const [row] = await tx
          .select({ id: reportFiles.id })
          .from(reportFiles)
          .where(and(eq(reportFiles.id, id), state === 'ready' ? due : lost))
          .for('update', { skipLocked: true });
        if (!row) return false;
        if (state === 'ready') {
          await this.files.remove(companyId, id);
          await tx.update(reportFiles).set({ state: 'expired' }).where(eq(reportFiles.id, id));
        } else {
          await tx
            .update(reportFiles)
            .set({ state: 'failed', error: 'RENDER_LOST' })
            .where(eq(reportFiles.id, id));
        }
        return true;
      });
      if (done && state === 'ready') expired += 1;
      if (done && state === 'queued') failed += 1;
    }
    if (expired + failed > 0) {
      this.logger.log(`Report files: ${expired} expired, ${failed} lost and failed`);
    }
    return { expired, lost: failed };
  }
}
