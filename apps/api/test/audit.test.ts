import type { INestApplication } from '@nestjs/common';
import { auditEntries, type Database, withCompany } from '@vertex-mizan/db';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { joinCompany, newCompany, signedInPerson, testDatabase } from './people.js';

// The company audit log (S01 rules 23–26): read by owners and auditors, by cursor, with filters;
// opening it is itself logged; another company's entries never show. All values are synthetic.

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

describe('GET /api/audit', () => {
  it('pages the log newest first, writes that it was opened, and filters', async () => {
    const owner = await signedInPerson(app, db);
    const company = await newCompany(owner.browser);
    // 120 synthetic entries, so the log has a second page.
    await withCompany(db, company.id, (tx) =>
      tx.insert(auditEntries).values(
        Array.from({ length: 120 }, (_, n) => ({
          companyId: company.id,
          createdAt: new Date(Date.UTC(2026, 9, 1, 0, n)),
          actorKind: 'system',
          actorName: 'Vertex',
          requestId: `request-${n}`,
          action: 'company.updated',
          entityType: 'company',
          entityId: company.id,
          before: { name: `اسم ${n}` },
          after: { name: `اسم ${n + 1}` },
        })),
      ),
    );
    const first = await owner.browser.get('/api/audit');
    expect(first.status).toBe(200);
    expect(first.body.entries).toHaveLength(100);
    expect(first.body.entries[0].action).toBe('session.company_entered');
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await owner.browser.get('/api/audit', { cursor: first.body.nextCursor });
    const ids = new Set([...first.body.entries, ...second.body.entries].map((entry) => entry.id));
    expect(ids.size).toBe(first.body.entries.length + second.body.entries.length);
    expect(second.body.nextCursor).toBeNull();

    const viewed = await owner.browser.get('/api/audit', { action: 'audit.viewed' });
    expect(viewed.body.entries.length).toBeGreaterThanOrEqual(1);
    expect(viewed.body.entries[0]).toMatchObject({
      actorUserId: owner.person.id,
      actorName: owner.person.name,
      ipAddress: owner.browser.address,
      userAgent: 'Mizan test browser',
    });
    const range = await owner.browser.get('/api/audit', {
      action: 'company.updated',
      from: '2026-10-01T00:10:00.000Z',
      to: '2026-10-01T00:19:00.000Z',
    });
    expect(range.body.entries).toHaveLength(10);
  });

  it('pages rows of the same microsecond across a page boundary without losing one', async () => {
    const owner = await signedInPerson(app, db);
    const company = await newCompany(owner.browser);
    // 101 entries at one time with microseconds, which a JavaScript Date cannot hold.
    await withCompany(db, company.id, (tx) =>
      tx.insert(auditEntries).values(
        Array.from({ length: 101 }, (_, n) => ({
          companyId: company.id,
          createdAt: sql`'2026-10-01 00:00:00.123456+00'::timestamptz`,
          actorKind: 'system',
          actorName: 'Vertex',
          requestId: `request-${n}`,
          action: 'company.updated',
          entityType: 'company',
          entityId: company.id,
        })),
      ),
    );
    const first = await owner.browser.get('/api/audit', { action: 'company.updated' });
    expect(first.body.entries).toHaveLength(100);
    const second = await owner.browser.get('/api/audit', {
      action: 'company.updated',
      cursor: first.body.nextCursor,
    });
    expect(second.body.entries).toHaveLength(1);
    const ids = new Set([...first.body.entries, ...second.body.entries].map((entry) => entry.id));
    expect(ids.size).toBe(101);
  });

  it('is for owners and auditors, and shows only the active company', async () => {
    const owner = await signedInPerson(app, db);
    const company = await newCompany(owner.browser);
    const other = await newCompany(owner.browser, { name: 'شركة ثانية' });
    const auditor = await joinCompany(app, db, company.id, 'auditor');
    const accountant = await joinCompany(app, db, company.id, 'accountant');

    const read = await auditor.browser.get('/api/audit');
    expect(read.status).toBe(200);
    expect(
      read.body.entries.every((entry: { entityId: string | null }) => entry.entityId !== other.id),
    ).toBe(true);
    const refused = await accountant.browser.get('/api/audit');
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('FORBIDDEN');
  });

  it('refuses a read naming the company the session left, and logs no opening', async () => {
    const owner = await signedInPerson(app, db);
    const company = await newCompany(owner.browser);
    const other = await newCompany(owner.browser, { name: 'شركة ثانية' });
    const openings = () =>
      withCompany(db, other.id, (tx) =>
        tx
          .select({ id: auditEntries.id })
          .from(auditEntries)
          .where(
            and(eq(auditEntries.companyId, other.id), eq(auditEntries.action, 'audit.viewed')),
          ),
      );
    const before = (await openings()).length;
    const stale = await owner.browser.get('/api/audit', undefined, {
      'x-mizan-company': company.id,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('COMPANY_SWITCHED');
    expect((await openings()).length).toBe(before);
  });
});
