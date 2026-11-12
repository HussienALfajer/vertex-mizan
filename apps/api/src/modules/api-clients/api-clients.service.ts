import { Inject, Injectable } from '@nestjs/common';
import {
  type ApiClient,
  type ApiClientKey,
  type CreateApiClient,
  type CreatedApiClient,
  DOCUMENT_TYPES,
  type DocumentType,
  type NewApiKey,
  needsReconcileFrom,
  type UpdateApiClient,
} from '@vertex-mizan/contracts';
import {
  apiClientKeys,
  apiClients,
  checkReconcileFromMove,
  type Database,
  documentSources,
  type Transaction,
  withCompany,
} from '@vertex-mizan/db';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { newApiKey } from '../../core/access/api-keys.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { type AuditActor, changedFields, writeCompanyAudit } from '../../core/audit/audit.js';
import { DATABASE } from '../../core/database/database.module.js';
import { onUniqueViolation } from '../../core/database/unique-violation.js';
import { CodedException } from '../../core/errors/coded-exception.js';

type ClientRow = typeof apiClients.$inferSelect;
type KeyRow = typeof apiClientKeys.$inferSelect;

const keyOf = (row: KeyRow): ApiClientKey => ({
  id: row.id,
  prefix: row.prefix,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  lastUsedIp: row.lastUsedIp,
  revokedAt: row.revokedAt?.toISOString() ?? null,
  revokeReason: row.revokeReason,
});

/** The clients' unique name answers as a failed field, the one refusal the spec names. */
const NAME_TAKEN = { api_clients_name_key: 'VALIDATION_FAILED' } as const;

/**
 * API clients, their keys and the document sources (S05 rules 19–21), managed by the owner after
 * a fresh two-factor code and read by the owner and the auditor. Clients and keys are platform rows
 * scoped by the company; every change runs in the company's transaction with its audit rows, the
 * company row locked first (S01 rule 12), then the client's row.
 */
@Injectable()
export class ApiClientsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `GET /api/api-clients`: the company's clients, oldest first, with their keys and sources. */
  async list(access: CompanyRouteAccess): Promise<ApiClient[]> {
    return withCompany(this.db, access.company.id, async (tx) => {
      const rows = await tx
        .select()
        .from(apiClients)
        .where(eq(apiClients.scopeCompanyId, access.company.id))
        .orderBy(asc(apiClients.createdAt), asc(apiClients.id));
      return this.shape(tx, rows);
    });
  }

  /**
   * `POST /api/api-clients` (rules 19, 21): the client and its first key, shown once; a `hub`
   * client becomes the source of every document type the company has no source for yet.
   */
  async create(access: CompanyRouteAccess, input: CreateApiClient): Promise<CreatedApiClient> {
    const companyId = access.company.id;
    const actor = actorOf(access);
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const [client] = await onUniqueViolation(
        () =>
          tx
            .insert(apiClients)
            .values({
              scopeCompanyId: companyId,
              name: input.name,
              system: input.system,
              scopes: input.scopes,
              ipAllowList: input.ipAllowList,
              reconcileFrom: input.reconcileFrom ?? null,
              createdByUserId: access.person.id,
            })
            .returning(),
        NAME_TAKEN,
      );
      if (!client) throw new Error('The client was not created');
      const assigned =
        input.system === 'hub' ? await this.assignFreeTypes(tx, companyId, client.id, actor) : [];
      await writeCompanyAudit(tx, companyId, actor, {
        action: 'api_client.created',
        entityType: 'api_client',
        entityId: client.id,
        after: { ...this.audited(client), documentTypes: assigned },
      });
      const key = await this.insertKey(tx, companyId, client.id, access);
      const [shaped] = await this.shape(tx, [client]);
      if (!shaped) throw new Error('The client was not read back');
      return { client: shaped, key };
    });
  }

  /**
   * `PUT /api/api-clients/:id`: the name, scopes and allow-list given; `documentTypes`, the whole
   * list the client is the source of, moves each type to it and the types it no longer lists to
   * none (rule 21). S08 rule 13: `reconcileFrom` moves earlier always, later only while no closed
   * month holds a day it would release (`RECONCILIATION_START_LOCKED`; the close locks the company
   * row too); scopes that need a start date are refused on a client without one.
   */
  async update(access: CompanyRouteAccess, id: string, input: UpdateApiClient): Promise<ApiClient> {
    const companyId = access.company.id;
    const actor = actorOf(access);
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const before = await this.lockClient(tx, companyId, id);
      if (
        input.reconcileFrom === undefined &&
        before.reconcileFrom === null &&
        needsReconcileFrom((input.scopes ?? before.scopes) as ApiClient['scopes'])
      ) {
        throw new CodedException('VALIDATION_FAILED', 'These scopes need a start date', [
          {
            path: ['reconcileFrom'],
            message: 'Required with events:write or reconciliation:write',
          },
        ]);
      }
      if (input.reconcileFrom !== undefined) {
        await checkReconcileFromMove(tx, { from: before.reconcileFrom, to: input.reconcileFrom });
      }
      const fields = {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.scopes !== undefined && { scopes: input.scopes }),
        ...(input.ipAllowList !== undefined && { ipAllowList: input.ipAllowList }),
        ...(input.reconcileFrom !== undefined && { reconcileFrom: input.reconcileFrom }),
      };
      let after = before;
      if (Object.keys(fields).length > 0) {
        const [row] = await onUniqueViolation(
          () => tx.update(apiClients).set(fields).where(eq(apiClients.id, id)).returning(),
          NAME_TAKEN,
        );
        if (!row) throw new Error('The client was not updated');
        after = row;
      }
      const typesBefore = await this.typesOf(tx, id);
      const typesAfter =
        input.documentTypes === undefined
          ? typesBefore
          : await this.setTypes(tx, companyId, after, input.documentTypes, actor);
      const change = changedFields(
        { ...this.audited(before), documentTypes: typesBefore },
        { ...this.audited(after), documentTypes: typesAfter },
      );
      if (change) {
        await writeCompanyAudit(tx, companyId, actor, {
          action: 'api_client.updated',
          entityType: 'api_client',
          entityId: id,
          ...change,
        });
      }
      const [shaped] = await this.shape(tx, [after]);
      if (!shaped) throw new Error('The client was not read back');
      return shaped;
    });
  }

  /** `POST /api/api-clients/:id/keys` (rule 19): a second key for a rotation, shown once. */
  async createKey(access: CompanyRouteAccess, id: string): Promise<NewApiKey> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const client = await this.lockClient(tx, companyId, id);
      if (client.archivedAt) throw new CodedException('NOT_FOUND', 'No such API client');
      const [active] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(apiClientKeys)
        .where(and(eq(apiClientKeys.apiClientId, id), isNull(apiClientKeys.revokedAt)));
      if ((active?.count ?? 0) >= 2) {
        throw new CodedException('API_KEY_LIMIT', 'Revoke a key before creating another');
      }
      return this.insertKey(tx, companyId, id, access);
    });
  }

  /**
   * `POST /api/api-clients/:id/keys/:keyId/revoke` (rule 19): refused at once from then on, kept
   * with its reason. A revoked key answers as it is.
   */
  async revokeKey(
    access: CompanyRouteAccess,
    id: string,
    keyId: string,
    reason: string,
  ): Promise<ApiClientKey> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      await this.lockClient(tx, companyId, id);
      const [key] = await tx
        .select()
        .from(apiClientKeys)
        .where(and(eq(apiClientKeys.id, keyId), eq(apiClientKeys.apiClientId, id)))
        .for('update');
      if (!key) throw new CodedException('NOT_FOUND', 'No such key');
      if (key.revokedAt) return keyOf(key);
      const revoked = await revokeKeys(tx, companyId, actorOf(access), reason, [key.id]);
      const [row] = revoked;
      if (!row) throw new Error('The key was not revoked');
      return keyOf(row);
    });
  }

  /** The client's row of this company, locked, or `NOT_FOUND`. */
  private async lockClient(tx: Transaction, companyId: string, id: string): Promise<ClientRow> {
    const [row] = await tx
      .select()
      .from(apiClients)
      .where(and(eq(apiClients.id, id), eq(apiClients.scopeCompanyId, companyId)))
      .for('update');
    if (!row) throw new CodedException('NOT_FOUND', 'No such API client');
    return row;
  }

  private async insertKey(
    tx: Transaction,
    companyId: string,
    clientId: string,
    access: CompanyRouteAccess,
  ): Promise<NewApiKey> {
    const { key, prefix, secretHash } = newApiKey();
    const [row] = await tx
      .insert(apiClientKeys)
      .values({
        apiClientId: clientId,
        scopeCompanyId: companyId,
        prefix,
        secretHash,
        createdByUserId: access.person.id,
      })
      .returning();
    if (!row) throw new Error('The key was not created');
    await writeCompanyAudit(tx, companyId, actorOf(access), {
      action: 'api_client_key.created',
      entityType: 'api_client_key',
      entityId: row.id,
      after: { apiClientId: clientId, prefix },
    });
    return { key: keyOf(row), secret: key };
  }

  /** Rule 21: every document type with no active source moves to the new Hub client. */
  private async assignFreeTypes(
    tx: Transaction,
    companyId: string,
    clientId: string,
    actor: AuditActor,
  ): Promise<DocumentType[]> {
    const rows = await tx.select().from(documentSources).for('update');
    const taken = new Set(rows.filter((row) => !row.archivedAt).map((row) => row.documentType));
    const free = DOCUMENT_TYPES.filter((type) => !taken.has(type));
    for (const type of free) await this.setSource(tx, companyId, type, clientId, actor);
    return free;
  }

  /** The client becomes the source of exactly `types`; the types it drops go to none. */
  private async setTypes(
    tx: Transaction,
    companyId: string,
    client: ClientRow,
    types: readonly DocumentType[],
    actor: AuditActor,
  ): Promise<DocumentType[]> {
    if (client.archivedAt && types.length > 0) {
      throw new CodedException('VALIDATION_FAILED', 'An archived client is no source', [
        { path: ['documentTypes'], message: 'An archived client is no source' },
      ]);
    }
    const rows = await tx.select().from(documentSources).for('update');
    for (const row of rows) {
      if (
        row.apiClientId === client.id &&
        !row.archivedAt &&
        !types.includes(row.documentType as DocumentType)
      ) {
        await tx
          .update(documentSources)
          .set({ archivedAt: new Date() })
          .where(eq(documentSources.id, row.id));
        await writeCompanyAudit(tx, companyId, actor, {
          action: 'document_source.set',
          entityType: 'document_source',
          entityId: row.id,
          before: { documentType: row.documentType, apiClientId: client.id },
          after: { documentType: row.documentType, apiClientId: null },
        });
      }
    }
    for (const type of types) await this.setSource(tx, companyId, type, client.id, actor);
    return this.typesOf(tx, client.id);
  }

  /** One type's source set to the client, audited when it changes. */
  private async setSource(
    tx: Transaction,
    companyId: string,
    type: DocumentType,
    clientId: string,
    actor: AuditActor,
  ): Promise<void> {
    const [row] = await tx
      .select()
      .from(documentSources)
      .where(eq(documentSources.documentType, type));
    if (row && row.apiClientId === clientId && !row.archivedAt) return;
    let id: string;
    if (row) {
      await tx
        .update(documentSources)
        .set({ apiClientId: clientId, archivedAt: null })
        .where(eq(documentSources.id, row.id));
      id = row.id;
    } else {
      const [inserted] = await tx
        .insert(documentSources)
        .values({ companyId, documentType: type, apiClientId: clientId })
        .returning({ id: documentSources.id });
      if (!inserted) throw new Error('The source was not set');
      id = inserted.id;
    }
    await writeCompanyAudit(tx, companyId, actor, {
      action: 'document_source.set',
      entityType: 'document_source',
      entityId: id,
      before: row
        ? { documentType: type, apiClientId: row.archivedAt ? null : row.apiClientId }
        : null,
      after: { documentType: type, apiClientId: clientId },
    });
  }

  /** The document types a client is the active source of, in the catalogue's order. */
  private async typesOf(tx: Transaction, clientId: string): Promise<DocumentType[]> {
    const rows = await tx
      .select({ type: documentSources.documentType })
      .from(documentSources)
      .where(and(eq(documentSources.apiClientId, clientId), isNull(documentSources.archivedAt)));
    const held = new Set(rows.map((row) => row.type));
    return DOCUMENT_TYPES.filter((type) => held.has(type));
  }

  private audited(row: ClientRow) {
    return {
      name: row.name,
      system: row.system,
      scopes: row.scopes,
      ipAllowList: row.ipAllowList,
      reconcileFrom: row.reconcileFrom,
    };
  }

  /** Clients as the API answers them, with their keys newest first and their document types. */
  private async shape(tx: Transaction, rows: readonly ClientRow[]): Promise<ApiClient[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const keys = await tx
      .select()
      .from(apiClientKeys)
      .where(inArray(apiClientKeys.apiClientId, ids))
      .orderBy(desc(apiClientKeys.createdAt), desc(apiClientKeys.id));
    const sources = await tx
      .select({ type: documentSources.documentType, clientId: documentSources.apiClientId })
      .from(documentSources)
      .where(and(inArray(documentSources.apiClientId, ids), isNull(documentSources.archivedAt)));
    return rows.map((row) => {
      const types = new Set(sources.filter((s) => s.clientId === row.id).map((s) => s.type));
      return {
        id: row.id,
        name: row.name,
        system: row.system as ApiClient['system'],
        scopes: row.scopes as ApiClient['scopes'],
        ipAllowList: row.ipAllowList,
        documentTypes: DOCUMENT_TYPES.filter((type) => types.has(type)),
        reconcileFrom: row.reconcileFrom,
        createdAt: row.createdAt.toISOString(),
        archivedAt: row.archivedAt?.toISOString() ?? null,
        keys: keys.filter((key) => key.apiClientId === row.id).map(keyOf),
      };
    });
  }
}

/**
 * Revokes active keys of the company in the caller's transaction, each with its audit row
 * (`api_client_key.revoked`): a key revoked by the owner (rule 19), or every active key when the
 * company is archived (S01 rule 12), with the archive's reason. Answers the revoked rows.
 */
export async function revokeKeys(
  tx: Transaction,
  companyId: string,
  actor: Extract<AuditActor, { kind: 'person' }>,
  reason: string,
  keyIds?: readonly string[],
): Promise<KeyRow[]> {
  // A key keeps 500 characters of its reason; the archive's may run to 1000.
  const kept = Array.from(reason).slice(0, 500).join('');
  const revoked = await tx
    .update(apiClientKeys)
    .set({ revokedAt: new Date(), revokedByUserId: actor.userId, revokeReason: kept })
    .where(
      and(
        eq(apiClientKeys.scopeCompanyId, companyId),
        isNull(apiClientKeys.revokedAt),
        keyIds === undefined ? undefined : inArray(apiClientKeys.id, [...keyIds]),
      ),
    )
    .returning();
  for (const key of revoked) {
    await writeCompanyAudit(tx, companyId, actor, {
      action: 'api_client_key.revoked',
      entityType: 'api_client_key',
      entityId: key.id,
      reason,
      before: { apiClientId: key.apiClientId, prefix: key.prefix, revokeReason: null },
      after: { apiClientId: key.apiClientId, prefix: key.prefix, revokeReason: kept },
    });
  }
  return revoked;
}
