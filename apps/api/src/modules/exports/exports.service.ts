import type { ReadStream } from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import type { CompanyExport, ExportState } from '@vertex-mizan/contracts';
import { companyExports, type Database, onUniqueViolation, withCompany } from '@vertex-mizan/db';
import { desc, eq, sql } from 'drizzle-orm';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { writeCompanyAudit } from '../../core/audit/audit.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { FileStore } from '../../core/files/file-store.js';
import { peopleOf, personOf } from '../entries/entry-shape.js';

type ExportRow = typeof companyExports.$inferSelect;

/** The exports a page lists: the newest, enough for a company's history of exports. */
const EXPORTS_LISTED = 50;

/** A ready export's file, to stream as a download. */
export interface ExportFile {
  readonly stream: ReadStream;
  readonly size: number;
  readonly fileName: string;
}

@Injectable()
export class ExportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FileStore) private readonly files: FileStore,
  ) {}

  /**
   * `POST /api/company/exports` (S03 rule 21): the owner, reauthenticated, queues a full export;
   * one at a time (`EXPORT_IN_PROGRESS`). The worker's `company.export` builds it. An archived
   * company's data can be exported too: it is a read of the books.
   */
  async request(access: CompanyRouteAccess): Promise<CompanyExport> {
    const companyId = access.company.id;
    return onUniqueViolation(
      () =>
        withCompany(this.db, companyId, async (tx) => {
          const [row] = await tx
            .insert(companyExports)
            .values({ companyId, requestedByUserId: access.person.id })
            .returning();
          if (!row) throw new Error('No export inserted');
          await writeCompanyAudit(tx, companyId, actorOf(access), {
            action: 'export.requested',
            entityType: 'company_export',
            entityId: row.id,
            after: { state: row.state },
          });
          const { id: personId, name } = access.person;
          return this.shape(row, new Map([[personId, { id: personId, name }]]));
        }),
      { company_exports_one_queued_key: 'EXPORT_IN_PROGRESS' },
    );
  }

  /** `GET /api/company/exports`: the newest exports first, with their states. */
  async list(access: CompanyRouteAccess): Promise<CompanyExport[]> {
    return withCompany(this.db, access.company.id, async (tx) => {
      const rows = await tx
        .select()
        .from(companyExports)
        .orderBy(desc(companyExports.createdAt), desc(companyExports.id))
        .limit(EXPORTS_LISTED);
      const people = await peopleOf(
        tx,
        rows.map((row) => row.requestedByUserId),
      );
      return rows.map((row) => this.shape(row, people));
    });
  }

  /**
   * `GET /api/company/exports/:id/download`: a ready export's ZIP within its 24 hours, audited;
   * past them the file is gone (`LINK_INVALID`). A queued or failed export has no file.
   */
  async download(access: CompanyRouteAccess, id: string): Promise<ExportFile> {
    const companyId = access.company.id;
    const row = await withCompany(this.db, companyId, async (tx) => {
      const [found] = await tx
        .select({
          row: companyExports,
          current: sql<boolean>`${companyExports.expiresAt} > now()`,
        })
        .from(companyExports)
        .where(eq(companyExports.id, id));
      if (!found || !['ready', 'expired'].includes(found.row.state)) {
        throw new CodedException('NOT_FOUND', 'No such export to download');
      }
      if (found.row.state === 'expired' || !found.current) {
        throw new CodedException('LINK_INVALID', 'The export has expired');
      }
      await writeCompanyAudit(tx, companyId, actorOf(access), {
        action: 'export.downloaded',
        entityType: 'company_export',
        entityId: found.row.id,
        after: { sizeBytes: found.row.sizeBytes, sha256: found.row.sha256 },
      });
      return found.row;
    });
    const file = await this.files.open(companyId, row.id);
    return {
      ...file,
      fileName: `mizan-export-${row.createdAt.toISOString().slice(0, 10)}.zip`,
    };
  }

  private shape(row: ExportRow, people: ReadonlyMap<string, { id: string; name: string }>) {
    return {
      id: row.id,
      state: row.state as ExportState,
      requestedBy: personOf(people, row.requestedByUserId),
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    } satisfies CompanyExport;
  }
}
