import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  auditEntries,
  companies,
  companyExports,
  type Database,
  sessions,
  withCompany,
} from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileStore } from '../src/core/files/file-store.js';
import { createTestApp } from './app.js';
import { type Books, books } from './books.js';
import { Browser } from './browser.js';
import { testDatabase } from './people.js';

// The full export through the API (S03 rule 21, acceptance step 8): the reauthenticated request,
// one at a time, the list, the download for 24 hours, its audit, and who may do it. The worker
// builds the file (`apps/worker`); here a ready export is made as the worker leaves it. Every
// value is synthetic.

let app: INestApplication;
let db: Database;

beforeAll(async () => {
  app = await createTestApp();
  db = testDatabase();
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

const request = (browser: Browser) => browser.post('/api/company/exports');

/** What the worker leaves: the file under the export's key, the row ready for `hours`. */
async function makeReady(book: Books, id: string, file: Buffer, hours = 24) {
  await app.get(FileStore).write(book.companyId, id, file);
  await withCompany(db, book.companyId, (tx) =>
    tx
      .update(companyExports)
      .set({
        state: 'ready',
        storageKey: `${book.companyId}/${id}`,
        sizeBytes: file.length,
        sha256: createHash('sha256').update(file).digest('hex'),
        expiresAt: new Date(Date.now() + hours * 3_600_000),
      })
      .where(eq(companyExports.id, id)),
  );
}

const actions = (book: Books) =>
  withCompany(db, book.companyId, (tx) =>
    tx.select({ action: auditEntries.action, entityId: auditEntries.entityId }).from(auditEntries),
  ).then((rows) => rows.filter((row) => row.action.startsWith('export.')));

describe('POST /api/company/exports', () => {
  it('queues the export once, then refuses another while it is queued', async () => {
    const book = await books(app, db);
    const first = await request(book.owner.browser);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({
      state: 'queued',
      requestedBy: { id: book.owner.person.id },
      sizeBytes: null,
      sha256: null,
      expiresAt: null,
    });
    const second = await request(book.owner.browser);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('EXPORT_IN_PROGRESS');
    expect(await actions(book)).toEqual([{ action: 'export.requested', entityId: first.body.id }]);
  });

  it('needs a fresh code (S03 "Access")', async () => {
    const book = await books(app, db);
    await db
      .update(sessions)
      .set({ reauthenticatedAt: null })
      .where(eq(sessions.userId, book.owner.person.id));
    const response = await request(book.owner.browser);
    expect(response.body.code).toBe('REAUTHENTICATION_REQUIRED');
  });

  it('is the owner’s only, in their company, archived or not', async () => {
    const book = await books(app, db);
    for (const role of ['accountant', 'approver', 'viewer', 'auditor'] as const) {
      const member = await book.join(role);
      expect((await request(member.browser)).body.code, role).toBe('FORBIDDEN');
      expect((await member.browser.get('/api/company/exports')).body.code, role).toBe('FORBIDDEN');
    }
    expect((await request(new Browser(app))).status).toBe(401);
    expect(
      (await book.owner.browser.post('/api/company/exports', {}, { 'x-mizan-company': uuidv7() }))
        .body.code,
    ).toBe('COMPANY_SWITCHED');
    await db
      .update(companies)
      .set({ archivedAt: new Date(), archivedReason: 'شركة اختبار مؤرشفة' })
      .where(eq(companies.id, book.companyId));
    expect((await request(book.owner.browser)).status).toBe(201);
  });
});

describe('GET /api/company/exports and the download', () => {
  it('lists the newest first and downloads a ready export as a ZIP, audited', async () => {
    const book = await books(app, db);
    const queued = await request(book.owner.browser);
    const file = Buffer.from('PK\u0005\u0006 synthetic archive');
    await makeReady(book, queued.body.id, file);
    const listed = await book.owner.browser.get('/api/company/exports');
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([
      expect.objectContaining({
        id: queued.body.id,
        state: 'ready',
        sizeBytes: file.length,
        sha256: createHash('sha256').update(file).digest('hex'),
        expiresAt: expect.any(String),
      }),
    ]);
    const download = await book.owner.browser.download(
      `/api/company/exports/${queued.body.id}/download`,
    );
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('application/zip');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.headers['content-disposition']).toMatch(
      /^attachment; filename="mizan-export-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    expect(download.body).toEqual(file);
    expect(await actions(book)).toEqual([
      { action: 'export.requested', entityId: queued.body.id },
      { action: 'export.downloaded', entityId: queued.body.id },
    ]);
  });

  it('answers LINK_INVALID past the 24 hours, and NOT_FOUND before the file exists', async () => {
    const book = await books(app, db);
    const queued = await request(book.owner.browser);
    const path = `/api/company/exports/${queued.body.id}/download`;
    expect(JSON.parse((await book.owner.browser.download(path)).body.toString()).code).toBe(
      'NOT_FOUND',
    );
    await makeReady(book, queued.body.id, Buffer.from('PK synthetic'), -1);
    const late = await book.owner.browser.download(path);
    expect(late.status).toBe(410);
    expect(JSON.parse(late.body.toString()).code).toBe('LINK_INVALID');
    await withCompany(db, book.companyId, (tx) =>
      tx
        .update(companyExports)
        .set({ state: 'expired' })
        .where(eq(companyExports.id, queued.body.id)),
    );
    expect(JSON.parse((await book.owner.browser.download(path)).body.toString()).code).toBe(
      'LINK_INVALID',
    );
  });

  it('never serves another company’s export', async () => {
    const book = await books(app, db);
    const queued = await request(book.owner.browser);
    await makeReady(book, queued.body.id, Buffer.from('PK synthetic'));
    const other = await books(app, db);
    expect((await other.owner.browser.get('/api/company/exports')).body).toEqual([]);
    const response = await other.owner.browser.download(
      `/api/company/exports/${queued.body.id}/download`,
    );
    expect(response.status).toBe(404);
  });
});
