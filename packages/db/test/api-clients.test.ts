import { createHash, randomBytes } from 'node:crypto';
import { API_CLIENT_SCOPES, API_CLIENT_SYSTEMS, DOCUMENT_TYPES } from '@vertex-mizan/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  apiClientKeys,
  apiClients,
  CLIENT_SCOPES,
  CLIENT_SYSTEMS,
  companies,
  type Database,
  documentSources,
  SOURCE_DOCUMENT_TYPES,
  users,
  withCompany,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// S05's API clients on the migrated database (0026, 0027): the clients and their keys (platform),
// the document sources (company), and the writes the API never makes, forged to prove the guards
// refuse them, as the app role and the owner. Every value is synthetic.

const { app, owner } = connect();

let personId = '';

beforeAll(async () => {
  const [row] = await app
    .insert(users)
    .values({ email: `api-clients-${uuidv7()}@example.test`, name: 'مالك تجريبي' })
    .returning({ id: users.id });
  personId = row?.id as string;
});

async function newCompany(): Promise<string> {
  const [row] = await app
    .insert(companies)
    .values({ name: 'شركة عملاء تجريبية', createdByUserId: personId })
    .returning({ id: companies.id });
  return row?.id as string;
}

async function newClient(companyId: string, name = 'Vertex Hub'): Promise<string> {
  const [row] = await app
    .insert(apiClients)
    .values({
      scopeCompanyId: companyId,
      name,
      system: 'hub',
      scopes: ['events:write', 'periods:read'],
      reconcileFrom: '2026-10-19',
      createdByUserId: personId,
    })
    .returning({ id: apiClients.id });
  return row?.id as string;
}

/** A synthetic key as the API makes one: `mzn_` and 40 base62 characters, stored as its hash. */
function newSecret() {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const key = `mzn_${[...randomBytes(40)].map((b) => alphabet[b % 62]).join('')}`;
  return { prefix: key.slice(0, 12), secretHash: createHash('sha256').update(key).digest('hex') };
}

function addKey(db: Database, companyId: string, clientId: string) {
  return db
    .insert(apiClientKeys)
    .values({
      apiClientId: clientId,
      scopeCompanyId: companyId,
      createdByUserId: personId,
      ...newSecret(),
    })
    .returning({ id: apiClientKeys.id });
}

const revoke = (db: Database, keyId: string) =>
  db
    .update(apiClientKeys)
    .set({ revokedAt: new Date(), revokedByUserId: personId, revokeReason: 'تدوير المفتاح' })
    .where(eq(apiClientKeys.id, keyId));

async function activeKeys(clientId: string): Promise<number> {
  const rows = await app
    .select({ id: apiClientKeys.id })
    .from(apiClientKeys)
    .where(and(eq(apiClientKeys.apiClientId, clientId), isNull(apiClientKeys.revokedAt)));
  return rows.length;
}

describe('the API-client lists', () => {
  it('equal contracts’ systems, scopes and document types', () => {
    expect(CLIENT_SYSTEMS).toEqual(API_CLIENT_SYSTEMS);
    expect(CLIENT_SCOPES).toEqual(API_CLIENT_SCOPES);
    expect(SOURCE_DOCUMENT_TYPES).toEqual(DOCUMENT_TYPES);
  });
});

describe('api_clients', () => {
  it('refuses an unknown system, an empty or unknown scope and a null address', async () => {
    const companyId = await newCompany();
    const base = {
      scopeCompanyId: companyId,
      name: 'Vertex Hub',
      system: 'hub',
      scopes: ['events:write'],
      reconcileFrom: '2026-10-19',
      createdByUserId: personId,
    };
    expect(await refusal(app.insert(apiClients).values({ ...base, system: 'erp' }))).toMatch(
      /api_clients_system/,
    );
    expect(await refusal(app.insert(apiClients).values({ ...base, scopes: [] }))).toMatch(
      /api_clients_scopes/,
    );
    expect(
      await refusal(app.insert(apiClients).values({ ...base, scopes: ['events:read'] })),
    ).toMatch(/api_clients_scopes/);
    expect(
      await refusal(
        app
          .insert(apiClients)
          .values({ ...base, ipAllowList: sql`array['10.0.0.0/8', null]::cidr[]` as never }),
      ),
    ).toMatch(/api_clients_ip_allow_list/);
    await app.insert(apiClients).values({ ...base, ipAllowList: ['10.0.0.0/8', '192.0.2.7/32'] });
    expect(await refusal(app.insert(apiClients).values(base))).toMatch(/api_clients_name_key/);
  });

  it('requires a start date with events:write or reconciliation:write, and never clears it (S08 rule 13)', async () => {
    const companyId = await newCompany();
    const base = {
      scopeCompanyId: companyId,
      system: 'hub',
      createdByUserId: personId,
    };
    for (const scopes of [
      ['events:write'],
      ['reconciliation:write'],
      ['periods:read', 'events:write'],
    ]) {
      expect(
        await refusal(app.insert(apiClients).values({ ...base, name: scopes.join(), scopes })),
      ).toMatch(/api_clients_reconcile_from/);
    }
    const [reader] = await app
      .insert(apiClients)
      .values({ ...base, name: 'قارئ الفترات', scopes: ['periods:read'] })
      .returning({ id: apiClients.id });
    const readerId = reader?.id as string;
    expect(
      await refusal(
        app
          .update(apiClients)
          .set({ scopes: ['events:write'] })
          .where(eq(apiClients.id, readerId)),
      ),
    ).toMatch(/api_clients_reconcile_from/);
    await app
      .update(apiClients)
      .set({ scopes: ['events:write'], reconcileFrom: '2026-11-01' })
      .where(eq(apiClients.id, readerId));
    // Moved later or earlier by the API's rule; never cleared, even with the scope removed.
    await app
      .update(apiClients)
      .set({ reconcileFrom: '2026-10-19' })
      .where(eq(apiClients.id, readerId));
    await app
      .update(apiClients)
      .set({ scopes: ['periods:read'] })
      .where(eq(apiClients.id, readerId));
    expect(
      await refusal(
        app.update(apiClients).set({ reconcileFrom: null }).where(eq(apiClients.id, readerId)),
      ),
    ).toMatch(/start date is never cleared/);
  });

  it('never moves a client to another company or system', async () => {
    const [companyA, companyB] = [await newCompany(), await newCompany()];
    const clientId = await newClient(companyA);
    expect(
      await refusal(
        app.update(apiClients).set({ scopeCompanyId: companyB }).where(eq(apiClients.id, clientId)),
      ),
    ).toMatch(/never moves/);
    await app
      .update(apiClients)
      .set({ name: 'Vertex Hub 2', scopes: ['events:write'], ipAllowList: ['198.51.100.0/24'] })
      .where(eq(apiClients.id, clientId));
  });
});

describe('api_client_keys', () => {
  it('keeps at most two active keys per client, and a third after a revocation', async () => {
    const companyId = await newCompany();
    const clientId = await newClient(companyId);
    const [first] = await addKey(app, companyId, clientId);
    await addKey(app, companyId, clientId);
    expect(await refusal(addKey(app, companyId, clientId))).toMatch(/at most two active keys/);
    await revoke(app, first?.id as string);
    await addKey(app, companyId, clientId);
    expect(await activeKeys(clientId)).toBe(2);
  });

  it('lets one of two keys created at once pass when the client has one', async () => {
    const companyId = await newCompany();
    const clientId = await newClient(companyId);
    await addKey(app, companyId, clientId);
    const results = await Promise.allSettled([
      addKey(app, companyId, clientId),
      addKey(app, companyId, clientId),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await activeKeys(clientId)).toBe(2);
  });

  it('creates a key active and unused, of its client’s company', async () => {
    const [companyA, companyB] = [await newCompany(), await newCompany()];
    const clientId = await newClient(companyA);
    const values = {
      apiClientId: clientId,
      scopeCompanyId: companyA,
      createdByUserId: personId,
      ...newSecret(),
    };
    expect(
      await refusal(
        app.insert(apiClientKeys).values({
          ...values,
          revokedAt: new Date(),
          revokedByUserId: personId,
          revokeReason: 'سبب',
        }),
      ),
    ).toMatch(/created active/);
    expect(
      await refusal(
        app
          .insert(apiClientKeys)
          .values({ ...values, lastUsedAt: new Date(), lastUsedIp: '192.0.2.1' }),
      ),
    ).toMatch(/created active/);
    expect(
      await refusal(app.insert(apiClientKeys).values({ ...values, scopeCompanyId: companyB })),
    ).toMatch(/a client of its company/);
    expect(
      await refusal(app.insert(apiClientKeys).values({ ...values, prefix: 'mzn_short' })),
    ).toMatch(/api_client_keys_prefix/);
    expect(
      await refusal(app.insert(apiClientKeys).values({ ...values, secretHash: 'not-a-hash' })),
    ).toMatch(/api_client_keys_secret_hash/);
  });

  it('gives no key to an archived client or to a client of an archived company', async () => {
    const companyId = await newCompany();
    const archivedClient = await newClient(companyId, 'عميل مؤرشف');
    await app
      .update(apiClients)
      .set({ archivedAt: new Date() })
      .where(eq(apiClients.id, archivedClient));
    expect(await refusal(addKey(app, companyId, archivedClient))).toMatch(/archived client/);
    const clientId = await newClient(companyId);
    await app
      .update(companies)
      .set({ archivedAt: new Date(), archivedReason: 'شركة مؤرشفة تجريبية' })
      .where(eq(companies.id, companyId));
    expect(await refusal(addKey(app, companyId, clientId))).toMatch(/archived client or company/);
  });

  it('changes a key only by its use and its revocation, and never once revoked', async () => {
    const companyId = await newCompany();
    const clientId = await newClient(companyId);
    const [key] = await addKey(app, companyId, clientId);
    const keyId = key?.id as string;
    const byId = eq(apiClientKeys.id, keyId);
    await app
      .update(apiClientKeys)
      .set({ lastUsedAt: new Date(), lastUsedIp: '192.0.2.10' })
      .where(byId);
    expect(
      await refusal(
        app
          .update(apiClientKeys)
          .set({ secretHash: 'a'.repeat(64) })
          .where(byId),
      ),
    ).toMatch(/only by its use and its revocation/);
    expect(
      await refusal(app.update(apiClientKeys).set({ createdByUserId: uuidv7() }).where(byId)),
    ).toMatch(/only by its use and its revocation/);
    expect(
      await refusal(app.update(apiClientKeys).set({ revokedAt: new Date() }).where(byId)),
    ).toMatch(/api_client_keys_revocation/);
    await revoke(app, keyId);
    for (const change of [
      { revokedAt: null, revokedByUserId: null, revokeReason: null },
      { revokeReason: 'سبب آخر' },
      { lastUsedAt: new Date(), lastUsedIp: '192.0.2.11' },
    ]) {
      expect(await refusal(app.update(apiClientKeys).set(change).where(byId))).toMatch(
        /revoked and never changes again/,
      );
    }
    expect(
      await refusal(app.update(apiClientKeys).set({ archivedAt: new Date() }).where(byId)),
    ).toMatch(/revoked and never changes again|api_client_keys_never_archived/);
  });
});

describe('document_sources', () => {
  it('names a client of its own company, active while the source is', async () => {
    const [companyA, companyB] = [await newCompany(), await newCompany()];
    const clientA = await newClient(companyA);
    const clientB = await newClient(companyB);
    await withCompany(app, companyA, async (tx) => {
      await tx
        .insert(documentSources)
        .values({ companyId: companyA, documentType: 'invoice', apiClientId: clientA });
    });
    expect(
      await refusal(
        withCompany(app, companyA, (tx) =>
          tx
            .insert(documentSources)
            .values({ companyId: companyA, documentType: 'payment', apiClientId: clientB }),
        ),
      ),
    ).toMatch(/a client of its company/);
    expect(
      await refusal(
        withCompany(app, companyA, (tx) =>
          tx
            .insert(documentSources)
            .values({ companyId: companyA, documentType: 'cheque', apiClientId: clientA }),
        ),
      ),
    ).toMatch(/document_sources_document_type/);
    expect(
      await refusal(
        withCompany(app, companyA, (tx) =>
          tx
            .insert(documentSources)
            .values({ companyId: companyA, documentType: 'invoice', apiClientId: clientA }),
        ),
      ),
    ).toMatch(/document_sources_document_type_key/);
  });

  it('moves a type to another client or to none, never to another type or company', async () => {
    const companyId = await newCompany();
    const first = await newClient(companyId, 'Vertex Hub');
    const second = await newClient(companyId, 'Vertex Hub 2');
    const archived = await newClient(companyId, 'عميل مؤرشف');
    await app.update(apiClients).set({ archivedAt: new Date() }).where(eq(apiClients.id, archived));
    await withCompany(app, companyId, async (tx) => {
      const [row] = await tx
        .insert(documentSources)
        .values({ companyId, documentType: 'payment', apiClientId: first })
        .returning({ id: documentSources.id });
      const byId = eq(documentSources.id, row?.id as string);
      await tx.update(documentSources).set({ apiClientId: second }).where(byId);
      await tx.update(documentSources).set({ archivedAt: new Date() }).where(byId);
      // An archived source may keep naming a client that is archived since.
      await tx
        .update(documentSources)
        .set({ apiClientId: archived, archivedAt: new Date() })
        .where(byId);
    });
    const [row] = await withCompany(app, companyId, (tx) =>
      tx.select({ id: documentSources.id }).from(documentSources),
    );
    const byId = eq(documentSources.id, row?.id as string);
    expect(
      await refusal(
        withCompany(app, companyId, (tx) =>
          tx.update(documentSources).set({ archivedAt: null }).where(byId),
        ),
      ),
    ).toMatch(/an archived client is no source/);
    expect(
      await refusal(
        withCompany(app, companyId, (tx) =>
          tx
            .update(documentSources)
            .set({ documentType: 'invoice', apiClientId: first, archivedAt: null })
            .where(byId),
        ),
      ),
    ).toMatch(/not to another type/);
  });

  it('is invisible outside its company and in another', async () => {
    const [companyA, companyB] = [await newCompany(), await newCompany()];
    const clientA = await newClient(companyA);
    await withCompany(app, companyA, (tx) =>
      tx
        .insert(documentSources)
        .values({ companyId: companyA, documentType: 'rate', apiClientId: clientA }),
    );
    expect(await app.select().from(documentSources)).toEqual([]);
    expect(await withCompany(app, companyB, (tx) => tx.select().from(documentSources))).toEqual([]);
    expect(
      await refusal(
        withCompany(app, companyB, (tx) =>
          tx
            .insert(documentSources)
            .values({ companyId: companyA, documentType: 'invoice', apiClientId: clientA }),
        ),
      ),
    ).toMatch(/row-level security/);
  });
});

describe('no deletion', () => {
  it('refuses DELETE to the app role (no grant) and the owner (refuse_delete)', async () => {
    const companyId = await newCompany();
    const clientId = await newClient(companyId);
    await addKey(app, companyId, clientId);
    await withCompany(app, companyId, (tx) =>
      tx
        .insert(documentSources)
        .values({ companyId, documentType: 'ad_spend', apiClientId: clientId }),
    );
    for (const table of [apiClients, apiClientKeys] as const) {
      expect(await refusal(app.delete(table))).toMatch(/permission denied/);
      expect(await refusal(owner.delete(table))).toMatch(/is never deleted/);
      expect(await refusal(owner.execute(sql`truncate ${table} cascade`))).toMatch(
        /is never deleted/,
      );
    }
    expect(await refusal(withCompany(app, companyId, (tx) => tx.delete(documentSources)))).toMatch(
      /permission denied/,
    );
    expect(
      await refusal(withCompany(owner, companyId, (tx) => tx.delete(documentSources))),
    ).toMatch(/is never deleted/);
  });
});
