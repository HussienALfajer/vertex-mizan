import type { INestApplication } from '@nestjs/common';
import {
  auditEntries,
  companies,
  companySettings,
  type Database,
  invitations,
  platformAuditEntries,
  sessions,
  withCompany,
} from '@vertex-mizan/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lockCompanyForWrite } from '../src/core/access/company-lock.js';
import { createTestApp } from './app.js';
import { Browser } from './browser.js';
import {
  companyInput,
  createPerson,
  joinCompany,
  newCompany,
  reauthenticate,
  signedInPerson,
  signIn,
  testDatabase,
} from './people.js';

// Companies (S01 rules 9–13, 19–22): creation, entering, the profile, the ledgers and their lock,
// archive and restore. All companies and people are synthetic.

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

async function companyLog(companyId: string) {
  return withCompany(db, companyId, (tx) =>
    tx
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.companyId, companyId))
      .orderBy(auditEntries.createdAt, auditEntries.id),
  );
}

describe('POST /api/companies', () => {
  it('creates the company, its ledgers and the creator as owner, in both audit logs', async () => {
    const { browser } = await signedInPerson(app, db);
    const response = await browser.post('/api/companies', companyInput());
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: 'شركة اختبار',
      ledgers: {
        book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin' } },
        parallel: {
          currency: 'USD',
          ratePolicy: { rateType: 'market', acceptsTransactionRate: true },
        },
      },
      fiscalYearStartMonth: 1,
      booksStarted: false,
      archived: null,
    });
    const me = await browser.get('/api/me');
    expect(me.body.memberships).toEqual([
      expect.objectContaining({
        role: 'owner',
        company: expect.objectContaining({ id: response.body.id }),
      }),
    ]);
    const [platform] = await db
      .select({ action: platformAuditEntries.action })
      .from(platformAuditEntries)
      .where(eq(platformAuditEntries.subjectCompanyId, response.body.id));
    expect(platform?.action).toBe('company.created');
    expect((await companyLog(response.body.id)).map((entry) => entry.action)).toEqual([
      'membership.created',
    ]);
  });

  it('creates every currency shape: one ledger, SYP-USD, USD-SYP', async () => {
    const { browser } = await signedInPerson(app, db);
    const book = (currency: 'SYP' | 'USD') => ({
      currency,
      ratePolicy: { rateType: 'market' as const, acceptsTransactionRate: false },
    });
    for (const ledgers of [
      { book: book('SYP'), parallel: null },
      { book: book('SYP'), parallel: book('USD') },
      { book: book('USD'), parallel: book('SYP') },
    ]) {
      const response = await browser.post('/api/companies', companyInput({ ledgers }));
      expect(response.status).toBe(201);
      expect(response.body.ledgers).toEqual(ledgers);
    }
  });

  it('refuses the parallel currency equal to the book one, and a transaction rate on bulletin', async () => {
    const { browser } = await signedInPerson(app, db);
    const same = await browser.post(
      '/api/companies',
      companyInput({
        ledgers: {
          book: {
            currency: 'SYP',
            ratePolicy: { rateType: 'market', acceptsTransactionRate: false },
          },
          parallel: {
            currency: 'SYP',
            ratePolicy: { rateType: 'market', acceptsTransactionRate: false },
          },
        },
      }),
    );
    expect(same.status).toBe(422);
    expect(same.body.code).toBe('VALIDATION_FAILED');
    const bulletin = await browser.post(
      '/api/companies',
      companyInput({
        ledgers: {
          book: {
            currency: 'SYP',
            ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: true },
          },
          parallel: null,
        },
      }),
    );
    expect(bulletin.body.code).toBe('VALIDATION_FAILED');
  });

  it('needs a signed-in person with two-factor', async () => {
    expect((await new Browser(app).post('/api/companies', companyInput())).status).toBe(401);
    const person = await createPerson(db);
    const browser = new Browser(app);
    await signIn(browser, person);
    const response = await browser.post('/api/companies', companyInput());
    expect(response.body.code).toBe('TWO_FACTOR_REQUIRED');
  });
});

describe('POST /api/session/company', () => {
  it('enters a company of mine and writes it to its log; another answers NOT_FOUND', async () => {
    const owner = await signedInPerson(app, db);
    const mine = await newCompany(owner.browser);
    const stranger = await signedInPerson(app, db);
    const theirs = await newCompany(stranger.browser);

    const me = await owner.browser.post('/api/session/company', { companyId: mine.id });
    expect(me.body).toMatchObject({
      activeCompanyId: mine.id,
      permissions: expect.arrayContaining(['company.settings']),
    });
    expect((await companyLog(mine.id)).map((entry) => entry.action)).toContain(
      'session.company_entered',
    );

    const refused = await owner.browser.post('/api/session/company', { companyId: theirs.id });
    expect(refused.status).toBe(404);
    expect(refused.body.code).toBe('NOT_FOUND');
    expect((await owner.browser.get('/api/me')).body.activeCompanyId).toBe(mine.id);
  });

  it('chooses the only company at sign-in', async () => {
    const owner = await signedInPerson(app, db);
    const company = await newCompany(owner.browser);
    const browser = new Browser(app);
    await signIn(browser, owner.person);
    expect((await browser.get('/api/me')).body.activeCompanyId).toBe(company.id);
  });
});

describe('GET /api/company', () => {
  it('answers every role of the company; without a company, COMPANY_NOT_SELECTED', async () => {
    const owner = await signedInPerson(app, db);
    const company = await newCompany(owner.browser);
    const viewer = await joinCompany(app, db, company.id, 'viewer');
    for (const browser of [owner.browser, viewer.browser]) {
      const response = await browser.get('/api/company');
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: company.id, policyNote: company.policyNote });
    }
    const outsider = await signedInPerson(app, db);
    const none = await outsider.browser.get('/api/company');
    expect(none.status).toBe(409);
    expect(none.body.code).toBe('COMPANY_NOT_SELECTED');
    expect((await new Browser(app).get('/api/company')).status).toBe(401);
  });
});

describe('PATCH /api/company', () => {
  it('changes the names and the policy note, each audited with before and after', async () => {
    const owner = await signedInPerson(app, db);
    const company = await newCompany(owner.browser);
    const response = await owner.browser.patch('/api/company', {
      name: 'شركة اختبار الجديدة',
      policyNote: 'مذكرة سياسة جديدة.',
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: 'شركة اختبار الجديدة',
      policyNote: 'مذكرة سياسة جديدة.',
    });
    const log = await companyLog(company.id);
    expect(log.find((entry) => entry.action === 'company.updated')).toMatchObject({
      before: { name: 'شركة اختبار' },
      after: { name: 'شركة اختبار الجديدة' },
      actorUserId: owner.person.id,
      ipAddress: owner.browser.address,
    });
    expect(log.find((entry) => entry.action === 'company.policy_note_updated')).toMatchObject({
      before: { policyNote: company.policyNote },
      after: { policyNote: 'مذكرة سياسة جديدة.' },
    });
  });

  it('refuses a role without the permission, a switched tab and a missing header', async () => {
    const owner = await signedInPerson(app, db);
    const company = await newCompany(owner.browser);
    const viewer = await joinCompany(app, db, company.id, 'viewer');
    const forbidden = await viewer.browser.patch('/api/company', { name: 'اسم' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');

    const other = await newCompany(owner.browser, { name: 'شركة ثانية' });
    // The tab still shows the first company; the session moved to the second.
    owner.browser.companyId = company.id;
    const switched = await owner.browser.patch('/api/company', { name: 'اسم آخر' });
    expect(switched.status).toBe(409);
    expect(switched.body.code).toBe('COMPANY_SWITCHED');
    owner.browser.companyId = null;
    const missing = await owner.browser.patch('/api/company', { name: 'اسم آخر' });
    expect(missing.body.code).toBe('COMPANY_SWITCHED');
    const [row] = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, other.id));
    expect(row?.name).toBe('شركة ثانية');
  });
});

describe('PUT /api/company/ledgers', () => {
  const ledgers = {
    book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
    parallel: {
      currency: 'USD',
      ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
    },
  };

  it('needs a fresh code, then changes the ledgers with the changed fields audited', async () => {
    const owner = await signedInPerson(app, db);
    const company = await newCompany(owner.browser);
    await db
      .update(sessions)
      .set({ reauthenticatedAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(sessions.userId, owner.person.id));
    const stale = await owner.browser.put('/api/company/ledgers', {
      ledgers,
      fiscalYearStartMonth: 4,
    });
    expect(stale.body.code).toBe('REAUTHENTICATION_REQUIRED');
    await reauthenticate(owner.browser, owner.person);
    const response = await owner.browser.put('/api/company/ledgers', {
      ledgers,
      fiscalYearStartMonth: 4,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ledgers, fiscalYearStartMonth: 4 });
    const entry = (await companyLog(company.id)).find(
      (row) => row.action === 'company.ledgers_updated',
    );
    expect(entry).toMatchObject({
      before: {
        parallelRateType: 'market',
        parallelAcceptsTransactionRate: true,
        fiscalYearStartMonth: 1,
      },
      after: {
        parallelRateType: 'bulletin',
        parallelAcceptsTransactionRate: false,
        fiscalYearStartMonth: 4,
      },
    });
    expect(Object.keys(entry?.after as object)).not.toContain('bookCurrency');
  });

  it('refuses any change once the books started; the policy note stays editable', async () => {
    const owner = await signedInPerson(app, db);
    const company = await newCompany(owner.browser);
    await withCompany(db, company.id, (tx) =>
      tx
        .update(companySettings)
        .set({ booksStartedAt: new Date() })
        .where(eq(companySettings.companyId, company.id)),
    );
    const locked = await owner.browser.put('/api/company/ledgers', {
      ledgers,
      fiscalYearStartMonth: 1,
    });
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('COMPANY_SETTINGS_LOCKED');
    expect((await owner.browser.get('/api/company')).body.booksStarted).toBe(true);
    const note = await owner.browser.patch('/api/company', { policyNote: 'ملاحظة بعد القفل.' });
    expect(note.status).toBe(200);
  });
});

describe('archive and restore', () => {
  it('make the company read-only and revoke pending invitations; restore reopens it', async () => {
    const owner = await signedInPerson(app, db);
    const company = await newCompany(owner.browser);
    await reauthenticate(owner.browser, owner.person);
    const invited = await owner.browser.post('/api/invitations', {
      email: 'invited.before.archive@example.test',
      role: 'viewer',
      canClosePeriods: false,
    });
    expect(invited.status).toBe(201);

    const archived = await owner.browser.post('/api/company/archive', { reason: 'نهاية النشاط' });
    expect(archived.status).toBe(200);
    expect(archived.body.archived).toMatchObject({ reason: 'نهاية النشاط' });
    const again = await owner.browser.post('/api/company/archive', { reason: 'مرة ثانية' });
    expect(again.body.archived.reason).toBe('نهاية النشاط');

    const write = await owner.browser.patch('/api/company', { name: 'اسم' });
    expect(write.status).toBe(409);
    expect(write.body.code).toBe('COMPANY_ARCHIVED');
    expect((await owner.browser.get('/api/company')).status).toBe(200);
    const [invitation] = await db
      .select({ revokedAt: invitations.revokedAt })
      .from(invitations)
      .where(eq(invitations.id, invited.body.id));
    expect(invitation?.revokedAt).not.toBeNull();
    const me = await owner.browser.get('/api/me');
    expect(me.body.memberships[0].company.archived).toBe(true);

    const restored = await owner.browser.post('/api/company/restore', { reason: 'استئناف' });
    expect(restored.status).toBe(200);
    expect(restored.body.archived).toBeNull();
    expect((await owner.browser.patch('/api/company', { name: 'اسم' })).status).toBe(200);
    const actions = (await companyLog(company.id)).map((entry) => entry.action);
    expect(actions.filter((action) => action === 'company.archived')).toHaveLength(1);
    expect(actions).toEqual(expect.arrayContaining(['invitation.revoked', 'company.restored']));
  });

  it('is for owners only', async () => {
    const owner = await signedInPerson(app, db);
    const company = await newCompany(owner.browser);
    const auditor = await joinCompany(app, db, company.id, 'auditor');
    const response = await auditor.browser.post('/api/company/archive', { reason: 'لا' });
    expect(response.body.code).toBe('FORBIDDEN');
    const [row] = await db
      .select({ archivedAt: companies.archivedAt })
      .from(companies)
      .where(and(eq(companies.id, company.id)));
    expect(row?.archivedAt).toBeNull();
  });
});

describe('writes to an archived company', () => {
  it('are refused inside their transaction too, whatever the guard saw', async () => {
    const owner = await signedInPerson(app, db);
    const company = await newCompany(owner.browser);
    await withCompany(db, company.id, (tx) => lockCompanyForWrite(tx, company.id));
    await db
      .update(companies)
      .set({ archivedAt: new Date(), archivedReason: 'اختبار' })
      .where(eq(companies.id, company.id));
    await expect(
      withCompany(db, company.id, (tx) => lockCompanyForWrite(tx, company.id)),
    ).rejects.toMatchObject({ code: 'COMPANY_ARCHIVED' });
  });

  it('refuse the ledgers to an accountant', async () => {
    const owner = await signedInPerson(app, db);
    const company = await newCompany(owner.browser);
    const accountant = await joinCompany(app, db, company.id, 'accountant');
    await reauthenticate(accountant.browser, accountant.person);
    const response = await accountant.browser.put('/api/company/ledgers', {
      ledgers: company.ledgers,
      fiscalYearStartMonth: 1,
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });
});

describe('two profile edits at once', () => {
  it('run one after the other, without a deadlock', async () => {
    const owner = await signedInPerson(app, db);
    await newCompany(owner.browser);
    const answers = await Promise.all([
      owner.browser.patch('/api/company', { name: 'الاسم الأول' }),
      owner.browser.patch('/api/company', { name: 'الاسم الثاني' }),
    ]);
    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
  });
});
