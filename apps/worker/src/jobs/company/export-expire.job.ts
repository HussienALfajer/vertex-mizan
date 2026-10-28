import { Inject, Injectable, Logger } from '@nestjs/common';
import { companyExports, type Database, withCompany } from '@vertex-mizan/db';
import { and, eq, lte, sql } from 'drizzle-orm';
import { DATABASE, JOBS_DATABASE } from '../../core/database/database.module.js';
import { FileStore } from '../../core/files/file-store.js';
import type { ScheduledJob } from '../../core/queue/scheduled-job.js';

const due = and(eq(companyExports.state, 'ready'), lte(companyExports.expiresAt, sql`now()`));

/**
 * The end of an export's 24 hours (S03 rule 21), hourly: the jobs role finds the ready exports
 * past their time across companies; in each company's context the file is deleted and the row
 * marked `expired`, keeping its size and digest as a record. A second run finds nothing; a file
 * already gone is no error.
 */
@Injectable()
export class CompanyExportExpireJob implements ScheduledJob {
  readonly queue = 'company.export-expire';
  readonly cron = '0 * * * *';
  private readonly logger = new Logger(CompanyExportExpireJob.name);

  constructor(
    @Inject(JOBS_DATABASE) private readonly jobs: Database,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FileStore) private readonly files: FileStore,
  ) {}

  async run(): Promise<{ expired: number }> {
    const found = await this.jobs
      .select({ companyId: companyExports.companyId, id: companyExports.id })
      .from(companyExports)
      .where(due);
    let expired = 0;
    for (const { companyId, id } of found) {
      expired += await withCompany(this.db, companyId, async (tx) => {
        const [row] = await tx
          .select({ id: companyExports.id })
          .from(companyExports)
          .where(and(eq(companyExports.id, id), due))
          .for('update', { skipLocked: true });
        if (!row) return 0;
        await this.files.remove(companyId, id);
        await tx.update(companyExports).set({ state: 'expired' }).where(eq(companyExports.id, id));
        return 1;
      });
    }
    if (expired > 0) this.logger.log(`Exports: ${expired} expired and their files deleted`);
    return { expired };
  }
}
