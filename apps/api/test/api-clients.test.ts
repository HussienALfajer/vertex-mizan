import type { INestApplication } from '@nestjs/common';
import type { ApiClient, CreatedApiClient, NewApiKey } from '@vertex-mizan/contracts';
import {
  apiClientKeys,
  auditEntries,
  type Database,
  sessions,
  withCompany,
} from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { secretHashOf } from '../src/core/access/api-keys.js';
import { createTestApp } from './app.js';
import { books, today } from './books.js';
import { expectGuarded } from './guards.js';
import { clientOf, hubClient, hubDocuments, invoiceIssued } from './hub.js';
import { joinCompany, newCompany, reauthenticate, signedInPerson, testDatabase } from './people.js';

// S05's API clients (rules 19–21) over HTTP: created, rotated and revoked by the owner after a
// fresh code, read by the auditor, the key shown once and kept as its hash, the document sources,
// and the keys revoked by the company's archive. Every value is synthetic.

let app: INestApplication;
let db: Database;

/** The person's code is older than the five-minute window (S01's re-authentication). */
const ageCode = (userId: string) =>
  db
    .update(sessions)
    .set({ reauthenticatedAt: new Date(Date.now() - 6 * 60 * 1000) })
    .where(eq(sessions.userId, userId));

beforeAll(async () => {
  app = await createTestApp();
  db = testDatabase();
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

const hubInput = {
  name: 'Vertex Hub',
  system: 'hub',
  scopes: ['events:write', 'periods:read'],
  ipAllowList: ['192.0.2.0/24', '2001:db8::/32'],
};

describe('POST /api/api-clients', () => {
  it('needs a fresh code, then answers the client and its key once, kept as its hash', async () => {
    const owner = await signedInPerson(app, db);
    const company = await newCompany(owner.browser);
    await ageCode(owner.person.id);
    expect((await owner.browser.post('/api/api-clients', hubInput)).body.code).toBe(
      'REAUTHENTICATION_REQUIRED',
    );
    await reauthenticate(owner.browser, owner.person);
    const created = await owner.browser.post('/api/api-clients', hubInput);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const { client, key } = created.body as CreatedApiClient;
    expect(client).toMatchObject({
      name: 'Vertex Hub',
      system: 'hub',
      scopes: ['events:write', 'periods:read'],
      ipAllowList: ['192.0.2.0/24', '2001:db8::/32'],
      archivedAt: null,
    });
    // A Hub client is the source of every document type the company had none for (rule 21).
    expect(client.documentTypes).toEqual([
      'invoice',
      'payment',
      'project_expense',
      'ad_wallet_entry',
      'ad_spend',
      'milestone',
      'project',
      'rate',
    ]);
    expect(key.secret).toMatch(/^mzn_[0-9A-Za-z]{40}$/);
    expect(key.key.prefix).toBe(key.secret.slice(0, 12));
    const [stored] = await db
      .select({ secretHash: apiClientKeys.secretHash })
      .from(apiClientKeys)
      .where(eq(apiClientKeys.id, key.key.id));
    expect(stored?.secretHash).toBe(secretHashOf(key.secret));
    // Never the secret again, and never in the audit log.
    const listed = await owner.browser.get('/api/api-clients');
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(key.secret);
    expect((listed.body as ApiClient[])[0]?.keys).toEqual([key.key]);
    const audit = await withCompany(db, company.id, (tx) =>
      tx.select({ action: auditEntries.action, after: auditEntries.after }).from(auditEntries),
    );
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'api_client.created',
        'api_client_key.created',
        'document_source.set',
      ]),
    );
    expect(JSON.stringify(audit)).not.toContain(key.secret);
  });

  it('refuses an unknown scope, a network with host bits and a name taken', async () => {
    const owner = await signedInPerson(app, db);
    await newCompany(owner.browser);
    await reauthenticate(owner.browser, owner.person);
    for (const body of [
      { ...hubInput, scopes: ['events:read'] },
      { ...hubInput, scopes: [] },
      { ...hubInput, ipAllowList: ['10.0.0.1/8'] },
      { ...hubInput, ipAllowList: ['not-an-address'] },
    ]) {
      const refused = await owner.browser.post('/api/api-clients', body);
      expect(refused.body.code, JSON.stringify(body)).toBe('VALIDATION_FAILED');
    }
    expect((await owner.browser.post('/api/api-clients', hubInput)).status).toBe(201);
    expect((await owner.browser.post('/api/api-clients', hubInput)).body.code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('is the owner’s; the auditor reads, the accountant does not', async () => {
    const book = await books(app, db);
    await hubClient(app, book.owner);
    const auditor = await book.join('auditor');
    const accountant = await book.join('accountant');
    expect((await auditor.browser.get('/api/api-clients')).status).toBe(200);
    expect((await auditor.browser.post('/api/api-clients', hubInput)).body.code).toBe('FORBIDDEN');
    expect((await accountant.browser.get('/api/api-clients')).body.code).toBe('FORBIDDEN');
  });

  it('answers the guard on every route', async () => {
    const id = uuidv7();
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/api-clients' },
      { method: 'post', path: '/api/api-clients' },
      { method: 'put', path: `/api/api-clients/${id}` },
      { method: 'post', path: `/api/api-clients/${id}/keys` },
      { method: 'post', path: `/api/api-clients/${id}/keys/${uuidv7()}/revoke` },
    ]);
  });
});

describe('keys', () => {
  it('rotate with a second key, refuse a third, and refuse a revoked key at once', async () => {
    const book = await books(app, db);
    const first = await hubClient(app, book.owner);
    const second = await book.owner.browser.post(`/api/api-clients/${first.id}/keys`);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const rotated = second.body as NewApiKey;
    expect((await book.owner.browser.post(`/api/api-clients/${first.id}/keys`)).body.code).toBe(
      'API_KEY_LIMIT',
    );
    // Both keys work during the rotation (edge case 20).
    const documents = hubDocuments();
    const newer = clientOf(app, first.id, rotated.secret, first.address);
    expect((await first.send(invoiceIssued(documents, today()))).status).toBe(201);
    expect((await newer.get('/v1/periods/status', { from: '2026-01', to: '2026-02' })).status).toBe(
      200,
    );
    const [oldKey] =
      ((await book.owner.browser.get('/api/api-clients')).body as ApiClient[])[0]?.keys.filter(
        (key) => key.id !== rotated.key.id,
      ) ?? [];
    expect(oldKey?.lastUsedAt).not.toBeNull();
    expect(oldKey?.lastUsedIp).toBe(first.address);
    const revoked = await book.owner.browser.post(
      `/api/api-clients/${first.id}/keys/${oldKey?.id}/revoke`,
      { reason: 'انتهى التدوير' },
    );
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
    expect(revoked.body).toMatchObject({ revokeReason: 'انتهى التدوير' });
    expect((await first.get('/v1/periods/status', { from: '2026-01', to: '2026-01' })).status).toBe(
      401,
    );
    // A third key once one is revoked; another company's key id is not found.
    expect((await book.owner.browser.post(`/api/api-clients/${first.id}/keys`)).status).toBe(201);
    const other = await books(app, db);
    await reauthenticate(other.owner.browser, other.owner.person);
    expect(
      (
        await other.owner.browser.post(
          `/api/api-clients/${first.id}/keys/${rotated.key.id}/revoke`,
          { reason: 'سبب' },
        )
      ).body.code,
    ).toBe('NOT_FOUND');
    expect((await other.owner.browser.post(`/api/api-clients/${first.id}/keys`)).body.code).toBe(
      'NOT_FOUND',
    );
  });

  it('are all revoked when the company is archived, and stay revoked after the restore', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    const archived = await book.owner.browser.post('/api/company/archive', {
      reason: 'إيقاف تجريبي',
    });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    const keys = await db
      .select({ revokedAt: apiClientKeys.revokedAt, reason: apiClientKeys.revokeReason })
      .from(apiClientKeys)
      .where(eq(apiClientKeys.apiClientId, hub.id));
    expect(keys).toEqual([{ revokedAt: expect.any(Date), reason: 'إيقاف تجريبي' }]);
    expect((await book.owner.browser.post('/api/company/restore', { reason: 'عودة' })).status).toBe(
      200,
    );
    expect((await hub.get('/v1/periods/status', { from: '2026-01', to: '2026-01' })).status).toBe(
      401,
    );
  });
});

describe('PUT /api/api-clients/:id', () => {
  it('moves document types between clients and to none, audited', async () => {
    const book = await books(app, db);
    const first = await hubClient(app, book.owner, { name: 'Vertex Hub' });
    const second = await hubClient(app, book.owner, { name: 'Vertex Hub 2' });
    const clients = (await book.owner.browser.get('/api/api-clients')).body as ApiClient[];
    expect(clients.find((client) => client.id === second.id)?.documentTypes).toEqual([]);
    const moved = await book.owner.browser.put(`/api/api-clients/${second.id}`, {
      documentTypes: ['payment', 'rate'],
      scopes: ['events:write'],
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body).toMatchObject({
      documentTypes: ['payment', 'rate'],
      scopes: ['events:write'],
    });
    const dropped = await book.owner.browser.put(`/api/api-clients/${first.id}`, {
      documentTypes: ['invoice'],
    });
    expect(dropped.body.documentTypes).toEqual(['invoice']);
    const after = (await book.owner.browser.get('/api/api-clients')).body as ApiClient[];
    expect(after.find((client) => client.id === second.id)?.documentTypes).toEqual([
      'payment',
      'rate',
    ]);
    const audit = await withCompany(db, book.companyId, (tx) =>
      tx.select({ action: auditEntries.action }).from(auditEntries),
    );
    expect(audit.filter((row) => row.action === 'api_client.updated')).toHaveLength(2);
    expect(
      (await book.owner.browser.put(`/api/api-clients/${uuidv7()}`, { name: 'x' })).body.code,
    ).toBe('NOT_FOUND');
  });

  it('needs a fresh code, and the owner’s role', async () => {
    const owner = await signedInPerson(app, db);
    const company = await newCompany(owner.browser);
    const hub = await hubClient(app, owner);
    const accountant = await joinCompany(app, db, company.id, 'accountant');
    expect(
      (await accountant.browser.put(`/api/api-clients/${hub.id}`, { name: 'x' })).body.code,
    ).toBe('FORBIDDEN');
    const secondOwner = await joinCompany(app, db, company.id, 'owner');
    await ageCode(secondOwner.person.id);
    for (const [method, path] of [
      ['put', `/api/api-clients/${hub.id}`],
      ['post', `/api/api-clients/${hub.id}/keys`],
    ] as const) {
      const refused = await secondOwner.browser[method](path, { name: 'x' });
      expect(refused.body.code, path).toBe('REAUTHENTICATION_REQUIRED');
    }
  });
});
