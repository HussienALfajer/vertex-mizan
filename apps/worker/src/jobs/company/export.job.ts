import { Inject, Injectable, Logger } from '@nestjs/common';
import { EXPORT_TTL_HOURS, emailDataSchemas } from '@vertex-mizan/contracts';
import {
  companies,
  companyExports,
  type Database,
  describeForLog,
  emailOutbox,
  users,
  withCompany,
} from '@vertex-mizan/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Config } from '../../core/config/config.js';
import { CONFIG } from '../../core/config/config.module.js';
import { DATABASE, JOBS_DATABASE } from '../../core/database/database.module.js';
import { FileStore } from '../../core/files/file-store.js';
import type { ScheduledJob } from '../../core/queue/scheduled-job.js';
import { buildArchive } from './archive.js';

/** How long a big company's export may read and write in its transaction (S03: ≤ 5 minutes). */
const EXPORT_TIMEOUT = '10min';

/** The code a failed export keeps: the error's own code when it has a short one, never a message. */
export function failureCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,100}$/.test(code) ? code : 'EXPORT_FAILED';
}

/**
 * The full export (S03 rule 21, "Jobs and events"), every minute: the jobs role finds the queued
 * exports across companies; each is built inside its company's context as the app role, from one
 * repeatable-read snapshot, under a row lock that a second worker skips. The ZIP is written under
 * the export's key through a temporary name (a retry overwrites its own file), the row becomes
 * `ready` for 24 hours and the owner who asked is emailed, in that transaction. A build that fails
 * marks the export `failed` with its code; the owner can ask again.
 */
@Injectable()
export class CompanyExportJob implements ScheduledJob {
  readonly queue = 'company.export';
  readonly cron = '* * * * *';
  private readonly logger = new Logger(CompanyExportJob.name);

  constructor(
    @Inject(JOBS_DATABASE) private readonly jobs: Database,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FileStore) private readonly files: FileStore,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async run(): Promise<{ built: number; failed: number }> {
    const queued = await this.jobs
      .select({ companyId: companyExports.companyId, id: companyExports.id })
      .from(companyExports)
      .where(eq(companyExports.state, 'queued'))
      .orderBy(asc(companyExports.id));
    let built = 0;
    let failed = 0;
    for (const { companyId, id } of queued) {
      try {
        if (await this.build(companyId, id)) built += 1;
      } catch (error) {
        this.logger.error(`Export ${id} failed: ${describeForLog(error)}`);
        await withCompany(this.db, companyId, (tx) =>
          tx
            .update(companyExports)
            .set({ state: 'failed', error: failureCode(error) })
            .where(and(eq(companyExports.id, id), eq(companyExports.state, 'queued'))),
        );
        failed += 1;
      }
    }
    if (queued.length > 0) this.logger.log(`Exports: ${built} built, ${failed} failed`);
    return { built, failed };
  }

  /** Builds one export; false when another worker holds it or it is no longer queued. */
  private build(companyId: string, id: string): Promise<boolean> {
    return withCompany(
      this.db,
      companyId,
      async (tx) => {
        await tx.execute(sql`set local statement_timeout = ${sql.raw(`'${EXPORT_TIMEOUT}'`)}`);
        await tx.execute(
          sql`set local idle_in_transaction_session_timeout = ${sql.raw(`'${EXPORT_TIMEOUT}'`)}`,
        );
        const [row] = await tx
          .select()
          .from(companyExports)
          .where(and(eq(companyExports.id, id), eq(companyExports.state, 'queued')))
          .for('update', { skipLocked: true });
        if (!row) return false;
        const archive = await buildArchive(tx, companyId, id, (attachmentId) =>
          this.files.read(companyId, attachmentId),
        );
        await this.files.write(companyId, id, archive.stream);
        const { size, sha256 } = await archive.done;
        const [ready] = await tx
          .update(companyExports)
          .set({
            state: 'ready',
            storageKey: `${companyId}/${id}`,
            sizeBytes: size,
            sha256,
            expiresAt: sql`now() + make_interval(hours => ${EXPORT_TTL_HOURS})`,
          })
          .where(eq(companyExports.id, id))
          .returning({ expiresAt: companyExports.expiresAt });
        const [owner] = await tx
          .select({ email: users.email, companyName: companies.name })
          .from(users)
          .innerJoin(companies, eq(companies.id, companyId))
          .where(eq(users.id, row.requestedByUserId));
        if (owner && ready?.expiresAt) {
          const data = emailDataSchemas.export_ready.parse({
            companyName: owner.companyName,
            link: `${this.config.appUrl}/settings/export`,
            expiresAt: ready.expiresAt.toISOString(),
          });
          await tx
            .insert(emailOutbox)
            .values({ kind: 'export_ready', recipient: owner.email.toLowerCase(), data });
        }
        return true;
      },
      { isolationLevel: 'repeatable read' },
    );
  }
}
