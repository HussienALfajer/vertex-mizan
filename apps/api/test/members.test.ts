import type { INestApplication } from '@nestjs/common';
import {
  auditEntries,
  type Database,
  emailOutbox,
  memberships,
  sessions,
  twoFactors,
  users,
  withCompany,
} from '@vertex-mizan/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { Browser } from './browser.js';
import { joinCompany, newCompany, reauthenticate, signedInPerson, testDatabase } from './people.js';

// Memberships (S01 rules 14–18, 21): the list, role changes, removal and leaving under the
// last-owner rule, and the owner's two-factor reset. All people and companies are synthetic.

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

async function ownerWithCompany() {
  const owner = await signedInPerson(app, db);
  const company = await newCompany(owner.browser);
  const [membership] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(eq(memberships.userId, owner.person.id), eq(memberships.scopeCompanyId, company.id)),
    );
  if (!membership) throw new Error('no owner membership');
  await reauthenticate(owner.browser, owner.person);
  return { ...owner, company, membershipId: membership.id };
}

async function actions(companyId: string): Promise<string[]> {
  const rows = await withCompany(db, companyId, (tx) =>
    tx
      .select({ action: auditEntries.action })
      .from(auditEntries)
      .orderBy(auditEntries.createdAt, auditEntries.id),
  );
  return rows.map((row) => row.action);
}

describe('GET /api/members', () => {
  it('lists the members for owners and auditors only', async () => {
    const owner = await ownerWithCompany();
    const auditor = await joinCompany(app, db, owner.company.id, 'auditor');
    const viewer = await joinCompany(app, db, owner.company.id, 'viewer');
    const list = await auditor.browser.get('/api/members');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(3);
    expect(list.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: owner.person.id, role: 'owner', twoFactorEnabled: true }),
      ]),
    );
    expect((await viewer.browser.get('/api/members')).body.code).toBe('FORBIDDEN');
  });
});

describe('PATCH /api/members/:id', () => {
  it('changes a role and the period permission, read on the next request', async () => {
    const owner = await ownerWithCompany();
    const accountant = await joinCompany(app, db, owner.company.id, 'accountant');
    expect((await accountant.browser.get('/api/me')).body.permissions).toEqual(['company.read']);
    const changed = await owner.browser.patch(`/api/members/${accountant.membershipId}`, {
      role: 'accountant',
      canClosePeriods: true,
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ role: 'accountant', canClosePeriods: true });
    expect((await accountant.browser.get('/api/me')).body.permissions).toEqual([
      'company.read',
      'periods.close',
    ]);
    const viewer = await owner.browser.patch(`/api/members/${accountant.membershipId}`, {
      role: 'viewer',
      canClosePeriods: true,
    });
    expect(viewer.body.code).toBe('VALIDATION_FAILED');
    expect(await actions(owner.company.id)).toContain('membership.updated');
  });

  it('refuses to demote the last owner', async () => {
    const owner = await ownerWithCompany();
    const response = await owner.browser.patch(`/api/members/${owner.membershipId}`, {
      role: 'accountant',
      canClosePeriods: false,
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('LAST_OWNER');
  });

  it('lets one of two owners demoting each other at once win, never both', async () => {
    const first = await ownerWithCompany();
    const second = await joinCompany(app, db, first.company.id, 'owner');
    await reauthenticate(second.browser, second.person);
    const demote = { role: 'viewer', canClosePeriods: false };
    const answers = await Promise.all([
      first.browser.patch(`/api/members/${second.membershipId}`, demote),
      second.browser.patch(`/api/members/${first.membershipId}`, demote),
    ]);
    const statuses = answers.map((answer) => answer.status).sort();
    // The loser either finds itself demoted (FORBIDDEN) or is the last owner (LAST_OWNER).
    expect(statuses[0]).toBe(200);
    expect(['FORBIDDEN', 'LAST_OWNER']).toContain(
      answers.find((answer) => answer.status !== 200)?.body.code,
    );
    const owners = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.scopeCompanyId, first.company.id), eq(memberships.role, 'owner')));
    expect(owners).toHaveLength(1);
  });

  it("answers another company's member as unknown, and changes nothing", async () => {
    const owner = await ownerWithCompany();
    const stranger = await ownerWithCompany();
    const response = await owner.browser.patch(`/api/members/${stranger.membershipId}`, {
      role: 'viewer',
      canClosePeriods: false,
    });
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
    const [row] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(eq(memberships.id, stranger.membershipId));
    expect(row?.role).toBe('owner');
  });

  it('needs a fresh code', async () => {
    const owner = await ownerWithCompany();
    const viewer = await joinCompany(app, db, owner.company.id, 'viewer');
    await db
      .update(sessions)
      .set({ reauthenticatedAt: null })
      .where(eq(sessions.userId, owner.person.id));
    const response = await owner.browser.patch(`/api/members/${viewer.membershipId}`, {
      role: 'auditor',
      canClosePeriods: false,
    });
    expect(response.body.code).toBe('REAUTHENTICATION_REQUIRED');
  });
});

describe('POST /api/members/:id/remove', () => {
  it('archives the membership; the removed person loses the company on their next request', async () => {
    const owner = await ownerWithCompany();
    const viewer = await joinCompany(app, db, owner.company.id, 'viewer');
    const removed = await owner.browser.post(`/api/members/${viewer.membershipId}/remove`, {
      reason: 'انتهى العقد',
    });
    expect(removed.status).toBe(204);
    const next = await viewer.browser.get('/api/company');
    expect(next.status).toBe(409);
    expect(next.body.code).toBe('COMPANY_NOT_SELECTED');
    const [row] = await db
      .select({ archivedReason: memberships.archivedReason })
      .from(memberships)
      .where(eq(memberships.id, viewer.membershipId));
    expect(row?.archivedReason).toBe('انتهى العقد');
    expect(await actions(owner.company.id)).toContain('membership.removed');
  });

  it('lets any member leave, but not the last owner', async () => {
    const owner = await ownerWithCompany();
    const viewer = await joinCompany(app, db, owner.company.id, 'viewer');
    const left = await viewer.browser.post(`/api/members/${viewer.membershipId}/remove`, {
      reason: 'مغادرة',
    });
    expect(left.status).toBe(204);
    expect(await actions(owner.company.id)).toContain('membership.left');
    const last = await owner.browser.post(`/api/members/${owner.membershipId}/remove`, {
      reason: 'مغادرة',
    });
    expect(last.body.code).toBe('LAST_OWNER');
  });

  it('refuses a member removing another', async () => {
    const owner = await ownerWithCompany();
    const viewer = await joinCompany(app, db, owner.company.id, 'viewer');
    const response = await viewer.browser.post(`/api/members/${owner.membershipId}/remove`, {
      reason: 'لا',
    });
    expect(response.body.code).toBe('FORBIDDEN');
  });
});

describe('POST /api/members/:id/reset-two-factor', () => {
  it('resets a member whose every company the owner owns, ends their sessions and emails them', async () => {
    const owner = await ownerWithCompany();
    const accountant = await joinCompany(app, db, owner.company.id, 'accountant');
    const response = await owner.browser.post(
      `/api/members/${accountant.membershipId}/reset-two-factor`,
      { reason: 'فقد الهاتف' },
    );
    expect(response.status).toBe(204);
    expect((await accountant.browser.get('/api/me')).status).toBe(401);
    expect(
      await db.select().from(twoFactors).where(eq(twoFactors.userId, accountant.person.id)),
    ).toEqual([]);
    const [person] = await db
      .select({ twoFactorEnabled: users.twoFactorEnabled })
      .from(users)
      .where(eq(users.id, accountant.person.id));
    expect(person?.twoFactorEnabled).toBe(false);
    const [notice] = await db
      .select({ data: emailOutbox.data })
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.recipient, accountant.person.email),
          eq(emailOutbox.kind, 'two_factor_reset'),
        ),
      );
    expect(notice?.data).toEqual({ companyName: owner.company.name });
    expect(await actions(owner.company.id)).toContain('membership.two_factor_reset');
  });

  it('refuses when the member also belongs to a company the owner does not own', async () => {
    const owner = await ownerWithCompany();
    const accountant = await joinCompany(app, db, owner.company.id, 'accountant');
    const elsewhere = await ownerWithCompany();
    await db.insert(memberships).values({
      userId: accountant.person.id,
      scopeCompanyId: elsewhere.company.id,
      role: 'viewer',
    });
    const response = await owner.browser.post(
      `/api/members/${accountant.membershipId}/reset-two-factor`,
      { reason: 'فقد الهاتف' },
    );
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('RESET_NOT_ALLOWED');
    expect((await accountant.browser.get('/api/me')).status).toBe(200);
  });

  it("refuses one's own reset", async () => {
    const owner = await ownerWithCompany();
    const response = await owner.browser.post(
      `/api/members/${owner.membershipId}/reset-two-factor`,
      { reason: 'لا' },
    );
    expect(response.body.code).toBe('RESET_NOT_ALLOWED');
  });
});

describe('the documented refusals of remove and reset-two-factor', () => {
  async function stale(personId: string) {
    await db
      .update(sessions)
      .set({ reauthenticatedAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(sessions.userId, personId));
  }

  it("answer another company's member as unknown and change nothing", async () => {
    const owner = await ownerWithCompany();
    const stranger = await ownerWithCompany();
    const theirs = await joinCompany(app, db, stranger.company.id, 'viewer');
    for (const path of [
      `/api/members/${theirs.membershipId}/remove`,
      `/api/members/${theirs.membershipId}/reset-two-factor`,
    ]) {
      const response = await owner.browser.post(path, { reason: 'لا' });
      expect(response.status, path).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    }
    const [row] = await db
      .select({ archivedAt: memberships.archivedAt })
      .from(memberships)
      .where(eq(memberships.id, theirs.membershipId));
    expect(row?.archivedAt).toBeNull();
    expect((await theirs.browser.get('/api/me')).status).toBe(200);
    expect(
      await db.select().from(twoFactors).where(eq(twoFactors.userId, theirs.person.id)),
    ).toHaveLength(1);
  });

  it('need a fresh code to remove another member or reset their two-factor', async () => {
    const owner = await ownerWithCompany();
    const viewer = await joinCompany(app, db, owner.company.id, 'viewer');
    await stale(owner.person.id);
    for (const path of [
      `/api/members/${viewer.membershipId}/remove`,
      `/api/members/${viewer.membershipId}/reset-two-factor`,
    ]) {
      const response = await owner.browser.post(path, { reason: 'سبب' });
      expect(response.status, path).toBe(403);
      expect(response.body.code).toBe('REAUTHENTICATION_REQUIRED');
    }
    expect((await viewer.browser.get('/api/company')).status).toBe(200);
  });

  it('refuse a role without members.manage, a switched tab and no session', async () => {
    const owner = await ownerWithCompany();
    const auditor = await joinCompany(app, db, owner.company.id, 'auditor');
    await reauthenticate(auditor.browser, auditor.person);
    const forbidden = await auditor.browser.post(
      `/api/members/${owner.membershipId}/reset-two-factor`,
      { reason: 'لا' },
    );
    expect(forbidden.body.code).toBe('FORBIDDEN');
    const viewer = await joinCompany(app, db, owner.company.id, 'viewer');
    for (const path of [
      `/api/members/${viewer.membershipId}/remove`,
      `/api/members/${viewer.membershipId}/reset-two-factor`,
    ]) {
      const switched = await owner.browser.post(
        path,
        { reason: 'سبب' },
        { 'x-mizan-company': auditor.membershipId },
      );
      expect(switched.status, path).toBe(409);
      expect(switched.body.code).toBe('COMPANY_SWITCHED');
      const anonymous = await new Browser(app).post(path, { reason: 'سبب' });
      expect(anonymous.status).toBe(401);
      expect(anonymous.body.code).toBe('UNAUTHENTICATED');
    }
  });
});
