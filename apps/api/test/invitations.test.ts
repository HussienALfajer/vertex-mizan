import type { INestApplication } from '@nestjs/common';
import {
  auditEntries,
  type Database,
  emailOutbox,
  invitations,
  memberships,
  verifications,
  withCompany,
} from '@vertex-mizan/db';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { Browser } from './browser.js';
import {
  createPerson,
  enrol,
  joinCompany,
  newCompany,
  reauthenticate,
  signedInPerson,
  signIn,
  testDatabase,
} from './people.js';

// Invitations (S01 rule 15): creation with its email, the pending list, revocation, the lookup and
// acceptance by a new or an existing person. All people, emails and companies are synthetic.

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
  await reauthenticate(owner.browser, owner.person);
  return { ...owner, company };
}

let emails = 0;
const newEmail = () => `invited.${Date.now()}.${emails++}@example.test`;

/** Invites `email` and returns the invitation and the token from its queued email. */
async function invite(owner: Browser, email: string, role = 'accountant', canClosePeriods = false) {
  const response = await owner.post('/api/invitations', { email, role, canClosePeriods });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const [queued] = await db
    .select({ data: emailOutbox.data })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.recipient, email.toLowerCase()), eq(emailOutbox.kind, 'invitation')))
    .orderBy(desc(emailOutbox.createdAt));
  const link = (queued?.data as { link: string } | undefined)?.link ?? '';
  return { invitation: response.body, link, token: new URL(link).hash.slice('#token='.length) };
}

describe('POST /api/invitations', () => {
  it('queues the email with the link, stores only the token hash, and lists it as pending', async () => {
    const owner = await ownerWithCompany();
    const email = newEmail();
    const { invitation, link, token } = await invite(owner.browser, email, 'accountant', true);
    expect(invitation).toMatchObject({
      email,
      role: 'accountant',
      canClosePeriods: true,
      invitedBy: { id: owner.person.id, name: owner.person.name },
    });
    expect(link).toMatch(/^http:\/\/mizan\.test\/invitation#token=[A-Za-z0-9_-]{43}$/);
    const [row] = await db
      .select({ identifier: invitations.verificationIdentifier })
      .from(invitations)
      .where(eq(invitations.id, invitation.id));
    expect(row?.identifier).toMatch(/^invite:[0-9a-f]{64}$/);
    expect(row?.identifier).not.toContain(token);
    const list = await owner.browser.get('/api/invitations');
    expect(list.body.map((entry: { id: string }) => entry.id)).toEqual([invitation.id]);
  });

  it('refuses a second pending invitation and an invitation for a member', async () => {
    const owner = await ownerWithCompany();
    const email = newEmail();
    await invite(owner.browser, email);
    const twice = await owner.browser.post('/api/invitations', {
      email: email.toUpperCase(),
      role: 'viewer',
      canClosePeriods: false,
    });
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe('INVITATION_EXISTS');
    const member = await owner.browser.post('/api/invitations', {
      email: owner.person.email,
      role: 'viewer',
      canClosePeriods: false,
    });
    expect(member.body.code).toBe('MEMBERSHIP_EXISTS');
  });

  it('replaces an expired invitation that the clean-up has not marked yet', async () => {
    const owner = await ownerWithCompany();
    const email = newEmail();
    const { invitation } = await invite(owner.browser, email);
    await db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, invitation.id));
    const again = await owner.browser.post('/api/invitations', {
      email,
      role: 'viewer',
      canClosePeriods: false,
    });
    expect(again.status).toBe(201);
  });

  it('is for owners with a fresh code', async () => {
    const owner = await ownerWithCompany();
    const auditor = await joinCompany(app, db, owner.company.id, 'auditor');
    const response = await auditor.browser.post('/api/invitations', {
      email: newEmail(),
      role: 'viewer',
      canClosePeriods: false,
    });
    expect(response.body.code).toBe('FORBIDDEN');
    expect((await auditor.browser.get('/api/invitations')).status).toBe(200);
  });
});

describe('accepting', () => {
  it('lets a new person set a name and password, then sign in and enrol', async () => {
    const owner = await ownerWithCompany();
    const email = newEmail();
    const { token } = await invite(owner.browser, email, 'accountant', true);
    const visitor = new Browser(app);
    const lookup = await visitor.post('/api/invitations/lookup', { token });
    expect(lookup.body).toEqual({
      companyName: owner.company.name,
      role: 'accountant',
      email,
      personExists: false,
    });
    const accepted = await visitor.post('/api/invitations/accept', {
      token,
      name: 'محاسب جديد',
      password: 'a password of my own',
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({
      company: { id: owner.company.id },
      role: 'accountant',
      canClosePeriods: true,
    });
    const person = {
      id: '',
      email,
      name: 'محاسب جديد',
      password: 'a password of my own',
      secret: null,
      backupCodes: [],
    };
    await signIn(visitor, person);
    await enrol(visitor, person);
    const me = await visitor.get('/api/me');
    expect(me.body.activeCompanyId).toBeNull();
    expect(me.body.memberships).toHaveLength(1);

    const twice = await new Browser(app).post('/api/invitations/accept', {
      token,
      name: 'شخص آخر',
      password: 'another password here',
    });
    expect(twice.status).toBe(410);
    expect(twice.body.code).toBe('LINK_INVALID');
    const log = await withCompany(db, owner.company.id, (tx) =>
      tx.select({ action: auditEntries.action }).from(auditEntries),
    );
    expect(log.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['invitation.created', 'invitation.accepted', 'membership.created']),
    );
  });

  it('asks an existing person to sign in as the invited email', async () => {
    const owner = await ownerWithCompany();
    const existing = await createPerson(db);
    const { token } = await invite(owner.browser, existing.email, 'viewer');
    expect(
      (await new Browser(app).post('/api/invitations/lookup', { token })).body.personExists,
    ).toBe(true);
    const anonymous = await new Browser(app).post('/api/invitations/accept', { token });
    expect(anonymous.body.code).toBe('UNAUTHENTICATED');

    const someoneElse = await signedInPerson(app, db);
    const mismatch = await someoneElse.browser.post('/api/invitations/accept', { token });
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.code).toBe('INVITATION_EMAIL_MISMATCH');

    const browser = new Browser(app);
    await signIn(browser, existing);
    expect((await browser.post('/api/invitations/accept', { token })).body.code).toBe(
      'TWO_FACTOR_REQUIRED',
    );
    await enrol(browser, existing);
    const accepted = await browser.post('/api/invitations/accept', { token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.role).toBe('viewer');
  });

  it('refuses an expired, a revoked and an unknown link', async () => {
    const owner = await ownerWithCompany();
    const expired = await invite(owner.browser, newEmail());
    await db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, expired.invitation.id));
    const revoked = await invite(owner.browser, newEmail());
    expect(
      (await owner.browser.post(`/api/invitations/${revoked.invitation.id}/revoke`)).status,
    ).toBe(204);
    expect(
      await db.select().from(verifications).where(eq(verifications.value, revoked.invitation.id)),
    ).toEqual([]);
    for (const token of [expired.token, revoked.token, 'B'.repeat(43)]) {
      const response = await new Browser(app).post('/api/invitations/lookup', { token });
      expect(response.status).toBe(410);
      expect(response.body.code).toBe('LINK_INVALID');
    }
  });

  it('allows a person who left to be invited again: a new membership', async () => {
    const owner = await ownerWithCompany();
    const viewer = await joinCompany(app, db, owner.company.id, 'viewer');
    await viewer.browser.post(`/api/members/${viewer.membershipId}/remove`, { reason: 'مغادرة' });
    const { token } = await invite(owner.browser, viewer.person.email, 'auditor');
    const accepted = await viewer.browser.post('/api/invitations/accept', { token });
    expect(accepted.status).toBe(200);
    const rows = await db
      .select({ archivedAt: memberships.archivedAt })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, viewer.person.id),
          eq(memberships.scopeCompanyId, owner.company.id),
        ),
      );
    expect(rows).toHaveLength(2);
  });
});

describe('POST /api/invitations/:id/revoke', () => {
  it("answers another company's invitation as unknown, and changes nothing", async () => {
    const owner = await ownerWithCompany();
    const stranger = await ownerWithCompany();
    const { invitation } = await invite(stranger.browser, newEmail());
    const response = await owner.browser.post(`/api/invitations/${invitation.id}/revoke`);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
    const [row] = await db
      .select({ revokedAt: invitations.revokedAt })
      .from(invitations)
      .where(eq(invitations.id, invitation.id));
    expect(row?.revokedAt).toBeNull();
  });
});

describe('the documented refusals of invitation writes', () => {
  it('refuse a role without members.manage and a switched tab', async () => {
    const owner = await ownerWithCompany();
    const { invitation } = await invite(owner.browser, newEmail());
    const auditor = await joinCompany(app, db, owner.company.id, 'auditor');
    const revoke = await auditor.browser.post(`/api/invitations/${invitation.id}/revoke`);
    expect(revoke.status).toBe(403);
    expect(revoke.body.code).toBe('FORBIDDEN');
    const switched = await owner.browser.post(
      '/api/invitations',
      { email: newEmail(), role: 'viewer', canClosePeriods: false },
      { 'x-mizan-company': invitation.id },
    );
    expect(switched.body.code).toBe('COMPANY_SWITCHED');
    const staleRead = await owner.browser.get('/api/invitations', undefined, {
      'x-mizan-company': invitation.id,
    });
    expect(staleRead.status).toBe(409);
    expect(staleRead.body.code).toBe('COMPANY_SWITCHED');
    const [row] = await db
      .select({ revokedAt: invitations.revokedAt })
      .from(invitations)
      .where(eq(invitations.id, invitation.id));
    expect(row?.revokedAt).toBeNull();
  });
});
