import type { INestApplication } from '@nestjs/common';
import { chartTemplate } from '@vertex-mizan/contracts';
import {
  auditEntries,
  chartAccounts,
  companies,
  companySettings,
  type Database,
  emailOutbox,
  invitations,
  platformAuditEntries,
  twoFactors,
  users,
  withCompany,
} from '@vertex-mizan/db';
import { and, desc, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  changeEmailByVertex,
  createAccountWithCompany,
  createCompanyWithOwner,
  parseChangeEmail,
  parseCreateAccount,
  parseCreateCompany,
  parseResetTwoFactor,
  resetTwoFactorByVertex,
} from '../src/admin/commands.js';
import { createTestApp } from './app.js';
import { Browser } from './browser.js';
import { createPerson, enrol, signedInPerson, signIn, testDatabase } from './people.js';

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
        template: 'general',
      },
      ownerEmail: 'first.owner@example.test',
      booksStart: null,
    });
    const base = ['--name', 'x', '--policy-note', 'y', '--owner-email', 'a@example.test'];
    // S10 rule 1: the books start, the first day of a month.
    expect(parseCreateCompany([...base, '--books-start', '2026-10-01']).booksStart).toBe(
      '2026-10-01',
    );
    expect(() => parseCreateCompany([...base, '--books-start', '2026-10-15'])).toThrow();
    expect(parseCreateCompany([...base, '--template', 'general']).company.template).toBe('general');
    expect(parseCreateCompany([...base, '--template', 'none']).company.template).toBeNull();
    // S11: the contracting chart (N5).
    expect(parseCreateCompany([...base, '--template', 'contracting']).company.template).toBe(
      'contracting',
    );
    expect(() => parseCreateCompany([...base, '--template', 'retail'])).toThrow();
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
        '--books-start',
        '2026-10-01',
      ]),
    );
    const [company] = await db.select().from(companies).where(eq(companies.id, created.companyId));
    expect(company?.createdByUserId).toBeNull();
    const [settings] = await withCompany(db, created.companyId, (tx) =>
      tx.select({ booksStart: companySettings.booksStart }).from(companySettings),
    );
    expect(settings?.booksStart).toBe('2026-10-01');
    // The general chart in the creation transaction (S02 rule 1), audited as the system.
    const chart = await withCompany(db, created.companyId, async (tx) => ({
      accounts: await tx.select({ code: chartAccounts.code }).from(chartAccounts),
      audit: await tx
        .select({ action: auditEntries.action, actorKind: auditEntries.actorKind })
        .from(auditEntries),
    }));
    expect(chart.accounts).toHaveLength(chartTemplate('general').accounts.length);
    expect(chart.audit).toContainEqual({ action: 'chart.template_applied', actorKind: 'system' });
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

describe('admin:create-account (S01 rules 2 and 9, owner 2026-11-16)', () => {
  const company = [
    '--name',
    'شركة اختبار',
    '--name-latin',
    'Test Company',
    '--book-currency',
    'USD',
    '--book-rate-type',
    'market',
    '--parallel-currency',
    'SYP',
    '--parallel-rate-type',
    'bulletin',
    '--template',
    'contracting',
    '--policy-note',
    'مذكرة سياسة تجريبية.',
  ];

  it('accepts the transaction rate by default only at market, and parses the person', () => {
    const input = parseCreateAccount([
      ...company,
      '--email',
      'Client.Owner@Example.TEST',
      '--person-name',
      'زبون تجريبي',
    ]);
    expect(input).toMatchObject({
      email: 'client.owner@example.test',
      personName: 'زبون تجريبي',
      booksStart: null,
      company: {
        ledgers: {
          book: {
            currency: 'USD',
            ratePolicy: { rateType: 'market', acceptsTransactionRate: true },
          },
          parallel: {
            currency: 'SYP',
            ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
          },
        },
        template: 'contracting',
      },
    });
    const person = ['--email', 'a@example.test', '--person-name', 'x'];
    expect(
      parseCreateAccount([...company, ...person, '--no-book-accepts-transaction-rate']).company
        .ledgers.book.ratePolicy.acceptsTransactionRate,
    ).toBe(false);
    expect(
      parseCreateAccount([...company, ...person, '--no-parallel']).company.ledgers.parallel,
    ).toBeNull();
    // The same default for admin:create-company: a bulletin parallel ledger needs no other flag.
    expect(
      parseCreateCompany([...company, '--owner-email', 'a@example.test']).company.ledgers.parallel
        ?.ratePolicy.acceptsTransactionRate,
    ).toBe(false);
    expect(() => parseCreateAccount([...company, '--email', 'a@example.test'])).toThrow();
    expect(() => parseCreateAccount([...company, ...person, '--password', 'chosen'])).toThrow();
  });

  it('makes an owner who signs in with the password alone and confirms with it', async () => {
    const email = `client.owner.${Date.now()}@example.test`;
    const created = await createAccountWithCompany(
      db,
      parseCreateAccount([...company, '--email', email, '--person-name', 'زبون تجريبي']),
    );
    expect(created.password).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{24}$/);

    const browser = new Browser(app);
    const first = await browser.post('/api/auth/sign-in/email', {
      email,
      password: created.password,
    });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ twoFactorRequired: false });
    const me = await browser.get('/api/me');
    expect(me.body.person).toMatchObject({ twoFactorEnabled: false, twoFactorExempt: true });
    expect(me.body.activeCompanyId).toBe(created.companyId);
    expect(me.body.memberships).toEqual([
      expect.objectContaining({
        role: 'owner',
        company: expect.objectContaining({ id: created.companyId }),
      }),
    ]);
    // Company routes answer with no second step.
    const read = await browser.get('/api/company');
    expect(read.status).toBe(200);
    expect(read.body.ledgers.book.currency).toBe('USD');

    // A sensitive action is confirmed by the password, never by a guess.
    const wrong = await browser.post('/api/auth/reauthenticate', { password: 'not the password' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    expect(
      (await browser.post('/api/auth/reauthenticate', { password: created.password })).status,
    ).toBe(204);

    // Audited as the system, with no password anywhere.
    const [platform] = await db
      .select()
      .from(platformAuditEntries)
      .where(
        and(eq(platformAuditEntries.action, 'user.created'), eq(platformAuditEntries.email, email)),
      );
    expect(platform).toMatchObject({ actorKind: 'system', details: { twoFactorExempt: true } });
    expect(JSON.stringify(platform)).not.toContain(created.password);
    const log = await withCompany(db, created.companyId, (tx) =>
      tx
        .select({ action: auditEntries.action, actorKind: auditEntries.actorKind })
        .from(auditEntries),
    );
    expect(log).toContainEqual({ action: 'membership.created', actorKind: 'system' });

    // Once enrolled, the person signs in and confirms with the code, as anyone.
    const person = {
      id: created.personId,
      email,
      name: 'زبون تجريبي',
      password: created.password,
      secret: null,
      backupCodes: [],
    };
    await enrol(browser, person);
    const entered = () =>
      withCompany(db, created.companyId, (tx) =>
        tx
          .select({ id: auditEntries.id })
          .from(auditEntries)
          .where(eq(auditEntries.action, 'session.company_entered')),
      );
    const enteredBefore = (await entered()).length;
    const again = new Browser(app);
    const step = await again.post('/api/auth/sign-in/email', { email, password: created.password });
    expect(step.body).toEqual({ twoFactorRequired: true });
    expect((await again.get('/api/company')).status).toBe(401);
    // The password alone entered nothing: the second step is still to pass.
    expect(await entered()).toHaveLength(enteredBefore);
    await signIn(again, person);
    const byPassword = await again.post('/api/auth/reauthenticate', { password: created.password });
    expect(byPassword.status).toBe(422);
  });

  /** A new exempt account and its company, from the command. */
  async function account(label: string) {
    const email = `${label}.${Date.now()}@example.test`;
    const created = await createAccountWithCompany(
      db,
      parseCreateAccount([...company, '--email', email, '--person-name', 'زبون تجريبي']),
    );
    return { ...created, email };
  }

  it('returns an enrolled exempt person to the password alone after a reset (edge case 14)', async () => {
    const created = await account('reset.exempt');
    const browser = new Browser(app);
    const person = {
      id: created.personId,
      email: created.email,
      name: 'زبون تجريبي',
      password: created.password,
      secret: null,
      backupCodes: [],
    };
    await signIn(browser, person);
    await enrol(browser, person);
    await resetTwoFactorByVertex(db, { email: created.email, reason: 'فقد الهاتف والرموز' });

    const again = new Browser(app);
    const step = await again.post('/api/auth/sign-in/email', {
      email: created.email,
      password: created.password,
    });
    expect(step.body).toEqual({ twoFactorRequired: false });
    expect((await again.get('/api/company')).status).toBe(200);
  });

  it('leaves a reset person who is not exempt with enrolment only (edge case 14)', async () => {
    const { person } = await signedInPerson(app, db);
    await resetTwoFactorByVertex(db, { email: person.email, reason: 'فقد الهاتف والرموز' });
    const browser = new Browser(app);
    await browser.post('/api/auth/sign-in/email', {
      email: person.email,
      password: person.password,
    });
    const me = await browser.get('/api/me/sign-ins');
    expect(me.body.code).toBe('TWO_FACTOR_REQUIRED');
  });

  it('counts wrong passwords at confirmation with sign-in failures, both ways (rule 2)', async () => {
    const first = await account('lock.confirm');
    const browser = new Browser(app);
    await browser.post('/api/auth/sign-in/email', {
      email: first.email,
      password: first.password,
    });
    for (let i = 0; i < 10; i += 1) {
      const wrong = await browser.post('/api/auth/reauthenticate', { password: `wrong ${i}` });
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    }
    // Locked: the right password is refused, at confirmation and at sign-in.
    const locked = await browser.post('/api/auth/reauthenticate', { password: first.password });
    expect(locked.body.code).toBe('INVALID_CREDENTIALS');
    const signInLocked = await new Browser(app).post('/api/auth/sign-in/email', {
      email: first.email,
      password: first.password,
    });
    expect(signInLocked.status).toBe(401);

    const second = await account('lock.signin');
    const signedIn = new Browser(app);
    await signedIn.post('/api/auth/sign-in/email', {
      email: second.email,
      password: second.password,
    });
    for (let i = 0; i < 10; i += 1) {
      await new Browser(app).post('/api/auth/sign-in/email', {
        email: second.email,
        password: `wrong ${i}`,
      });
    }
    const afterSignIns = await signedIn.post('/api/auth/reauthenticate', {
      password: second.password,
    });
    expect(afterSignIns.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses the email of an archived person too (edge case 15)', async () => {
    const archived = await createPerson(db, {
      email: `archived.person.${Date.now()}@example.test`,
    });
    await db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, archived.id));
    await expect(
      createAccountWithCompany(
        db,
        parseCreateAccount([...company, '--email', archived.email, '--person-name', 'x']),
      ),
    ).rejects.toThrow(/exists/);
  });

  it('refuses an email that already has a person, before writing anything', async () => {
    const { person } = await signedInPerson(app, db);
    // A name no other test uses: the other test files make companies at the same time.
    const name = `شركة مرفوضة ${uuidv7()}`;
    const named = company.map((value) => (value === 'شركة اختبار' ? name : value));
    await expect(
      createAccountWithCompany(
        db,
        parseCreateAccount([...named, '--email', person.email, '--person-name', 'x']),
      ),
    ).rejects.toThrow(/exists/);
    expect(await db.select().from(companies).where(eq(companies.name, name))).toEqual([]);
  });

  it('never confirms by password for a person who is not exempt', async () => {
    const { browser, person } = await signedInPerson(app, db);
    const refused = await browser.post('/api/auth/reauthenticate', { password: person.password });
    expect(refused.status).toBe(422);
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

describe('admin:change-email (owner, 2026-11-20)', () => {
  async function account() {
    const email = `before.${uuidv7()}@example.test`;
    const created = await createAccountWithCompany(
      db,
      parseCreateAccount([
        '--name',
        'شركة اختبار البريد',
        '--policy-note',
        'مذكرة سياسة تجريبية.',
        '--book-currency',
        'USD',
        '--no-parallel',
        '--template',
        'contracting',
        '--email',
        email,
        '--person-name',
        'مالك تجريبي',
      ]),
    );
    return { email, ...created };
  }

  it('moves the sign-in to the new email, keeps the person, company and password', async () => {
    const before = await account();
    const browser = new Browser(app);
    await browser.post('/api/auth/sign-in/email', {
      email: before.email,
      password: before.password,
    });
    expect((await browser.get('/api/me')).status).toBe(200);

    const after = `After.${uuidv7()}@Example.TEST`;
    const input = parseChangeEmail([
      '--from',
      before.email,
      '--to',
      after,
      '--reason',
      'البريد الحقيقي للشركة',
    ]);
    expect(input.to).toBe(after.toLowerCase());
    await changeEmailByVertex(db, input);

    // The open session ends; the old email no longer signs in.
    expect((await browser.get('/api/me')).status).toBe(401);
    const old = await new Browser(app).post('/api/auth/sign-in/email', {
      email: before.email,
      password: before.password,
    });
    expect(old.status).toBe(401);

    // The new email signs in with the same password, as the same person, in the same company.
    const next = new Browser(app);
    const signed = await next.post('/api/auth/sign-in/email', {
      email: input.to,
      password: before.password,
    });
    expect(signed.body).toEqual({ twoFactorRequired: false });
    const me = await next.get('/api/me');
    expect(me.body.person).toMatchObject({ id: before.personId, email: input.to });
    expect(me.body.activeCompanyId).toBe(before.companyId);

    const [entry] = await db
      .select()
      .from(platformAuditEntries)
      .where(
        and(
          eq(platformAuditEntries.email, input.to),
          eq(platformAuditEntries.action, 'user.email_changed'),
        ),
      );
    expect(entry).toMatchObject({
      actorKind: 'system',
      actorUserId: null,
      userAgent: 'admin:change-email',
      details: {
        personId: before.personId,
        from: before.email,
        to: input.to,
        reason: 'البريد الحقيقي للشركة',
      },
    });
  });

  it('refuses an unknown email, a taken one and the same one, changing nothing', async () => {
    const one = await account();
    const two = await account();
    const reason = 'اختبار';
    await expect(
      changeEmailByVertex(db, { from: 'nobody.here@example.test', to: 'x@example.test', reason }),
    ).rejects.toThrow('No person with that email');
    await expect(
      changeEmailByVertex(db, { from: one.email, to: two.email, reason }),
    ).rejects.toThrow('A person with the new email exists');
    await expect(
      changeEmailByVertex(db, { from: one.email, to: one.email, reason }),
    ).rejects.toThrow('The new email is the current one');
    const [still] = await db.select().from(users).where(eq(users.id, one.personId));
    expect(still?.email).toBe(one.email);
    expect(() =>
      parseChangeEmail(['--from', one.email, '--to', 'not an email', '--reason', 'x']),
    ).toThrow();
    expect(() => parseChangeEmail(['--from', one.email, '--to', 'x@example.test'])).toThrow();
  });
});
