import { Inject, Injectable } from '@nestjs/common';
import type { AuditEntry, AuditPage, AuditQuery } from '@vertex-mizan/contracts';
import { auditEntries, type Database, withCompany } from '@vertex-mizan/db';
import { and, desc, eq, gte, lt, lte, or, type SQL } from 'drizzle-orm';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { writeCompanyAudit } from '../../core/audit/audit.js';
import { DATABASE } from '../../core/database/database.module.js';
import { decodeCursor, pageOf } from '../../core/http/cursor.js';

/** 100 rows a page, by cursor on `(company_id, created_at)` (S01 "Volume and performance"). */
const AUDIT_PAGE = 100;

/** The company audit log (S01 rules 23–26), read by owners and auditors. */
@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * `GET /api/audit`: entries newest first, filtered. Opening the log (the first page) is itself
   * written to it (`audit.viewed`, rule 24), in the same transaction as the read.
   */
  async page(access: CompanyRouteAccess, query: AuditQuery): Promise<AuditPage> {
    const companyId = access.company.id;
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const filters: (SQL | undefined)[] = [
      eq(auditEntries.companyId, companyId),
      query.from ? gte(auditEntries.createdAt, new Date(query.from)) : undefined,
      query.to ? lte(auditEntries.createdAt, new Date(query.to)) : undefined,
      query.actorUserId ? eq(auditEntries.actorUserId, query.actorUserId) : undefined,
      query.action ? eq(auditEntries.action, query.action) : undefined,
      query.entityType ? eq(auditEntries.entityType, query.entityType) : undefined,
      query.entityId ? eq(auditEntries.entityId, query.entityId) : undefined,
      after
        ? or(
            lt(auditEntries.createdAt, after.createdAt),
            and(eq(auditEntries.createdAt, after.createdAt), lt(auditEntries.id, after.id)),
          )
        : undefined,
    ];
    return withCompany(this.db, companyId, async (tx) => {
      const rows = await tx
        .select()
        .from(auditEntries)
        .where(and(...filters))
        .orderBy(desc(auditEntries.createdAt), desc(auditEntries.id))
        .limit(AUDIT_PAGE + 1);
      if (!after) {
        await writeCompanyAudit(tx, companyId, actorOf(access), {
          action: 'audit.viewed',
          entityType: 'audit_log',
          entityId: null,
        });
      }
      return pageOf(rows, AUDIT_PAGE, (row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        actorKind: row.actorKind as AuditEntry['actorKind'],
        actorUserId: row.actorUserId,
        actorName: row.actorName,
        action: row.action as AuditEntry['action'],
        entityType: row.entityType,
        entityId: row.entityId,
        reason: row.reason,
        before: row.before as AuditEntry['before'],
        after: row.after as AuditEntry['after'],
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        requestId: row.requestId,
      }));
    });
  }
}
