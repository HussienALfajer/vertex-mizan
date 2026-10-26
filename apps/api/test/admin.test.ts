import type { INestApplication } from '@nestjs/common';
import {
  auditEntries,
  companies,
  type Database,
  emailOutbox,
  invitations,
  platformAuditEntries,
  twoFactors,
  withCompany,
} from '@vertex-mizan/db';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCompanyWithOwner,
  parseCreateCompany,
  parseResetTwoFactor,
  resetTwoFactorByVertex,
} from '../src/admin/commands.js';
import { createTestApp } from './app.js';
import { Browser } from './browser.js';
import { enrol, signedInPerson, signIn, testDatabase } from './people.js';

// The server commands (S01 rules 9 and 21), as the app role. All values are synthetic.

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

describe('admin:create-company', () => {
  it("takes Vertex Media's shape by default and refuses what the API would", () => {
    const input = parseCreateCompany([
      '--name',
      'شركة اختبار',
      '--policy-note',
      'العملة الوظيفية الليرة السورية.',
      '--owner-email',
      'First.Owner@Example.TEST',
    ]);
    expect(input).toEqual({
      company: {
        name: 'شركة اختبار',
        nameLatin: null,
        ledgers: {
          book: {
            currency: 'SYP',
            ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
          },
          parallel: {
            currency: 'USD',
            ratePolicy: { rateType: 'market', acceptsTransactionRate: true },
          },
        },
        fiscalYearStartMonth: 1,
        policyNote: 'العملة الوظيفية الليرة السورية.',
      },
      ownerEmail: 'first.owner@example.test',
    });
    expect(() =>
      parseCreateCompany(['--name', 'x', '--policy-note', 'y', '--owner-email', 'not an email']),
    ).toThrow();
    expect(() =>
      parseCreateCompany([
        '--name',
        'x',
        '--policy-note',
        'y',
        '--owner-email',
        'a@example.test',
        '--parallel-currency',
        'SYP',
      ]),
    ).toThrow();
  });

  it('creates the company with no creator and invites its first owner, who lands in it', async () => {
    const email = `first.owner.${Date.now()}@example.test`;
    const created = await createCompanyWithOwner(
      db,
      'http://mizan.test',
      parseCreateCompany([
        '--name',
        'شركة اختبار',
        '--policy-note',
        'مذكرة.',
        '--owner-email',
        email,
      ]),
    );
    const [company] = await db.select().from(companies).where(eq(companies.id, created.companyId));
    expect(company?.createdByUserId).toBeNull();
    const [invitation] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.id, created.invitationId));
    expect(invitation).toMatchObject({ role: 'owner', invitedByUserId: null, email });
    const [platform] = await db
      .select({ actorKind: platformAuditEntries.actorKind })
      .from(platformAuditEntries)
      .where(
        and(
          eq(platformAuditEntries.subjectCompanyId, created.companyId),
          eq(platformAuditEntries.action, 'company.created'),
        ),
      );
    expect(platform?.actorKind).toBe('system');

    const [queued] = await db
      .select({ data: emailOutbox.data })
      .from(emailOutbox)
      .where(eq(emailOutbox.recipient, email))
      .orderBy(desc(emailOutbox.createdAt));
    expect(queued?.data).toMatchObject({ inviterName: null, role: 'owner' });
    if (!queued) throw new Error('no invitation email');
    const token = new URL((queued.data as { link: string }).link).hash.slice('#token='.length);

    const browser = new Browser(app);
    const accepted = await browser.post('/api/invitations/accept', {
      token,
      name: 'المالك الأول',
      password: 'the first owner password',
    });
    expect(accepted.status).toBe(200);
    const person = {
      id: '',
      email,
      name: 'المالك الأول',
      password: 'the first owner password',
      secret: null,
      backupCodes: [],
    };
    await signIn(browser, person);
    await enrol(browser, person);
    const again = new Browser(app);
    await signIn(again, person);
    expect((await again.get('/api/me')).body.activeCompanyId).toBe(created.companyId);
    const log = await withCompany(db, created.companyId, (tx) =>
      tx
        .select({ action: auditEntries.action, actorKind: auditEntries.actorKind })
        .from(auditEntries),
    );
    expect(log).toEqual(
      expect.arrayContaining([
        { action: 'invitation.created', actorKind: 'system' },
        { action: 'membership.created', actorKind: 'person' },
      ]),
    );
  });
});

describe('admin:reset-two-factor', () => {
  it('removes the authenticator, ends the sessions and writes the platform log', async () => {
    const { browser, person } = await signedInPerson(app, db);
    const input = parseResetTwoFactor(['--email', person.email, '--reason', 'فقد الهاتف والرموز']);
    await resetTwoFactorByVertex(db, input);
    expect((await browser.get('/api/me')).status).toBe(401);
    expect(await db.select().from(twoFactors).where(eq(twoFactors.userId, person.id))).toEqual([]);
    const [entry] = await db
      .select()
      .from(platformAuditEntries)
      .where(
        and(
          eq(platformAuditEntries.email, person.email),
          eq(platformAuditEntries.action, 'user.two_factor_reset'),
        ),
      );
    expect(entry).toMatchObject({ actorKind: 'system', details: { reason: 'فقد الهاتف والرموز' } });
    const next = new Browser(app);
    const first = await next.post('/api/auth/sign-in/email', {
      email: person.email,
      password: person.password,
    });
    expect(first.body).toEqual({ twoFactorRequired: false });
  });

  it('refuses an unknown email', async () => {
    await expect(
      resetTwoFactorByVertex(db, { email: 'nobody.here@example.test', reason: 'لا' }),
    ).rejects.toThrow('No person with that email');
  });
});
