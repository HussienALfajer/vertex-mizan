import { CURRENCY_CODES, RATE_TYPES, ROLES } from '@vertex-mizan/contracts';
import { eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  auditEntries,
  companies,
  companySettings,
  type Database,
  invitations,
  membershipRole,
  memberships,
  platformAuditEntries,
  SETTINGS_CURRENCY_CODES,
  SETTINGS_RATE_TYPES,
  sessions,
  type Transaction,
  users,
  withCompany,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// S01's tables on the migrated database (0001_access.sql, 0002_access_guards.sql): the settings
// lock, both audit logs append-only for every role, the isolation of the two company tables, the
// rules the checks hold, and the ephemeral kind. All values are synthetic.

const { app, owner, superuser } = connect();
const DENIED = /permission denied for table/;
const LOCKED = /company_settings of company .* are locked since its first posted entry/;
const RLS_REFUSAL = /new row violates row-level security policy/;

let personId = '';
let companyA = '';
let companyB = '';

async function person(email: string): Promise<string> {
  const [row] = await app
    .insert(users)
    .values({ email, name: 'شخص تجريبي' })
    .returning({ id: users.id });
  if (!row) throw new Error('no user inserted');
  return row.id;
}

/** A company with SYP books at bulletin and a USD parallel ledger at market, as S01 pre-fills. */
async function company(createdByUserId: string): Promise<string> {
  const [row] = await app
    .insert(companies)
    .values({ name: 'شركة اختبار', createdByUserId })
    .returning({ id: companies.id });
  if (!row) throw new Error('no company inserted');
  await withCompany(app, row.id, (tx) =>
    tx.insert(companySettings).values({
      companyId: row.id,
      bookCurrency: 'SYP',
      bookRateType: 'bulletin',
      bookAcceptsTransactionRate: false,
      parallelCurrency: 'USD',
      parallelRateType: 'market',
      parallelAcceptsTransactionRate: true,
      policyNote: 'مذكرة سياسة تجريبية.',
    }),
  );
  return row.id;
}

const audit = (companyId: string, action = 'company.updated') => ({
  companyId,
  actorKind: 'person',
  actorUserId: personId,
  actorName: 'شخص تجريبي',
  requestId: 'request-synthetic',
  action,
  entityType: 'company',
  entityId: companyId,
});

const settingsOf = (db: Database, companyId: string) =>
  withCompany(db, companyId, async (tx) => {
    const [row] = await tx.select().from(companySettings);
    return row;
  });

/** Sets books_started_at, as the posting function will at the first posted entry (S03). */
const startBooks = (companyId: string) =>
  withCompany(app, companyId, (tx) =>
    tx.update(companySettings).set({ booksStartedAt: new Date('2026-10-26T09:00:00Z') }),
  );

beforeAll(async () => {
  personId = await person('person.one@example.test');
  companyA = await company(personId);
  companyB = await company(personId);
  await withCompany(app, companyA, (tx) => tx.insert(auditEntries).values(audit(companyA)));
  await withCompany(app, companyB, (tx) => tx.insert(auditEntries).values(audit(companyB)));
  await app.insert(platformAuditEntries).values({
    actorKind: 'person',
    actorUserId: personId,
    action: 'user.signed_in',
    requestId: 'request-synthetic',
  });
});

describe('the database lists', () => {
  it('match the contracts: currencies, rate types and roles', () => {
    expect(SETTINGS_CURRENCY_CODES).toEqual(CURRENCY_CODES);
    expect(SETTINGS_RATE_TYPES).toEqual(RATE_TYPES);
    expect(membershipRole.enumValues).toEqual(ROLES);
  });
});

describe('the settings lock', () => {
  const changes: [string, (tx: Transaction) => Promise<unknown>][] = [
    [
      'the book currency',
      (tx) => tx.update(companySettings).set({ bookCurrency: 'USD', parallelCurrency: 'SYP' }),
    ],
    ['the book rate type', (tx) => tx.update(companySettings).set({ bookRateType: 'market' })],
    [
      'the book policy',
      (tx) =>
        tx
          .update(companySettings)
          .set({ bookRateType: 'market', bookAcceptsTransactionRate: true }),
    ],
    [
      'the parallel ledger',
      (tx) =>
        tx.update(companySettings).set({
          parallelCurrency: null,
          parallelRateType: null,
          parallelAcceptsTransactionRate: null,
        }),
    ],
    [
      'the parallel policy',
      (tx) => tx.update(companySettings).set({ parallelAcceptsTransactionRate: false }),
    ],
    ['the fiscal year start', (tx) => tx.update(companySettings).set({ fiscalYearStartMonth: 7 })],
    [
      'books_started_at',
      (tx) => tx.update(companySettings).set({ booksStartedAt: new Date('2027-01-01T00:00:00Z') }),
    ],
  ];

  it('lets the ledgers change freely before the first posted entry', async () => {
    for (const [, change] of changes.slice(0, -1)) {
      const id = await company(personId);
      await withCompany(app, id, change);
    }
    const id = await company(personId);
    await withCompany(app, id, (tx) => tx.update(companySettings).set({ fiscalYearStartMonth: 7 }));
    expect((await settingsOf(app, id))?.fiscalYearStartMonth).toBe(7);
  });

  it('refuses every change to the ledgers and the fiscal year once the books started, for the app role', async () => {
    const id = await company(personId);
    await startBooks(id);
    for (const [what, change] of changes) {
      expect(await refusal(withCompany(app, id, change)), what).toMatch(LOCKED);
    }
    expect(await settingsOf(app, id)).toMatchObject({
      bookCurrency: 'SYP',
      bookRateType: 'bulletin',
      parallelCurrency: 'USD',
      parallelAcceptsTransactionRate: true,
      fiscalYearStartMonth: 1,
    });
  });

  it('refuses them for the owner role too, and in a replica session', async () => {
    const id = await company(personId);
    await startBooks(id);
    for (const [what, change] of changes) {
      expect(await refusal(withCompany(owner, id, change)), what).toMatch(LOCKED);
    }
    const client: pg.PoolClient = await superuser.connect();
    try {
      await client.query('begin');
      await client.query("set local session_replication_role = 'replica'");
      await client.query(`select set_config('app.company_id', $1, true)`, [id]);
      expect(
        await refusal(client.query("update company_settings set book_currency = 'TRY'")),
      ).toMatch(LOCKED);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('keeps the policy note editable after the books started', async () => {
    const id = await company(personId);
    await startBooks(id);
    await withCompany(app, id, (tx) =>
      tx.update(companySettings).set({ policyNote: 'مذكرة معدّلة.' }),
    );
    expect((await settingsOf(app, id))?.policyNote).toBe('مذكرة معدّلة.');
  });

  it('cannot be undone by deleting the settings and inserting them again, for any role', async () => {
    const id = await company(personId);
    await startBooks(id);
    expect(await refusal(withCompany(app, id, (tx) => tx.delete(companySettings)))).toMatch(DENIED);
    expect(await refusal(withCompany(owner, id, (tx) => tx.delete(companySettings)))).toBe(
      'company_settings is never deleted: DELETE refused',
    );
    expect(await refusal(owner.execute(sql`truncate company_settings`))).toBe(
      'company_settings is never deleted: TRUNCATE refused',
    );
    const client: pg.PoolClient = await superuser.connect();
    try {
      await client.query('begin');
      await client.query("set local session_replication_role = 'replica'");
      await client.query(`select set_config('app.company_id', $1, true)`, [id]);
      expect(await refusal(client.query('delete from company_settings'))).toBe(
        'company_settings is never deleted: DELETE refused',
      );
    } finally {
      await client.query('rollback');
      client.release();
    }
    expect((await settingsOf(app, id))?.booksStartedAt).not.toBeNull();
  });
});

describe('the settings checks', () => {
  const invalid: [string, Partial<typeof companySettings.$inferInsert>][] = [
    ['a currency outside the money module', { bookCurrency: 'JPY' }],
    ['the parallel currency equal to the book currency', { parallelCurrency: 'SYP' }],
    ['half a parallel ledger', { parallelRateType: null }],
    ["a bulletin policy accepting a transaction's rate", { bookAcceptsTransactionRate: true }],
    ['a fiscal year starting in month 13', { fiscalYearStartMonth: 13 }],
    ['an empty policy note', { policyNote: '' }],
  ];

  it.each(invalid)('refuse %s', async (_, change) => {
    expect(
      await refusal(withCompany(app, companyA, (tx) => tx.update(companySettings).set(change))),
    ).toMatch(/violates check constraint "company_settings_/);
  });

  it('accept a company with book currency only', async () => {
    await withCompany(app, companyA, (tx) =>
      tx.update(companySettings).set({
        parallelCurrency: null,
        parallelRateType: null,
        parallelAcceptsTransactionRate: null,
      }),
    );
  });
});

describe('the audit logs', () => {
  it('refuse UPDATE, DELETE and TRUNCATE by the app role, which has no such privilege', async () => {
    for (const work of [
      (tx: Transaction) => tx.update(auditEntries).set({ reason: 'changed' }),
      (tx: Transaction) => tx.delete(auditEntries),
      (tx: Transaction) => tx.execute(sql`truncate audit_entries`),
      (tx: Transaction) => tx.update(platformAuditEntries).set({ email: 'x@example.test' }),
      (tx: Transaction) => tx.delete(platformAuditEntries),
      (tx: Transaction) => tx.execute(sql`truncate platform_audit_entries`),
    ]) {
      expect(await refusal(withCompany(app, companyA, work))).toMatch(DENIED);
    }
  });

  it('refuse UPDATE, DELETE and TRUNCATE by the owner role, through the triggers', async () => {
    for (const table of ['audit_entries', 'platform_audit_entries'] as const) {
      const target = table === 'audit_entries' ? auditEntries : platformAuditEntries;
      expect(
        await refusal(
          withCompany(owner, companyA, (tx) => tx.update(target).set({ requestId: 'x' })),
        ),
      ).toBe(`${table} is append-only: UPDATE refused`);
      expect(await refusal(withCompany(owner, companyA, (tx) => tx.delete(target)))).toBe(
        `${table} is append-only: DELETE refused`,
      );
      expect(await refusal(owner.execute(sql.raw(`truncate ${table}`)))).toBe(
        `${table} is append-only: TRUNCATE refused`,
      );
    }
  });

  it('keep refusing in a replica session', async () => {
    const client: pg.PoolClient = await superuser.connect();
    const messages: string[] = [];
    try {
      await client.query('begin');
      await client.query("set local session_replication_role = 'replica'");
      for (const statement of [
        "update audit_entries set reason = 'changed'",
        'delete from platform_audit_entries',
        'truncate audit_entries',
      ]) {
        await client.query('savepoint attempt');
        messages.push(await refusal(client.query(statement)));
        await client.query('rollback to savepoint attempt');
      }
    } finally {
      await client.query('rollback');
      client.release();
    }
    expect(messages).toEqual([
      'audit_entries is append-only: UPDATE refused',
      'platform_audit_entries is append-only: DELETE refused',
      'audit_entries is append-only: TRUNCATE refused',
    ]);
  });

  it('record who acted, as a person, an API client or the system', async () => {
    for (const actor of [
      { actorKind: 'person', actorUserId: null },
      { actorKind: 'system', actorUserId: personId },
      { actorKind: 'api_client', actorUserId: null, actorApiClientId: null },
      { actorKind: 'someone' },
    ]) {
      expect(
        await refusal(
          withCompany(app, companyA, (tx) =>
            tx.insert(auditEntries).values({ ...audit(companyA), ...actor }),
          ),
        ),
        JSON.stringify(actor),
      ).toMatch(/violates check constraint "audit_entries_actor"/);
    }
    expect(
      await refusal(
        withCompany(app, companyA, (tx) =>
          tx.insert(auditEntries).values(audit(companyA, 'Company Updated')),
        ),
      ),
    ).toMatch(/audit_entries_action_shape/);
  });
});

describe('company isolation of the settings and the audit log', () => {
  it('shows each company only its own rows', async () => {
    for (const id of [companyA, companyB]) {
      const settings = await withCompany(app, id, (tx) =>
        tx.select({ companyId: companySettings.companyId }).from(companySettings),
      );
      expect(settings).toEqual([{ companyId: id }]);
      const entries = await withCompany(app, id, (tx) =>
        tx.selectDistinct({ companyId: auditEntries.companyId }).from(auditEntries),
      );
      expect(entries).toEqual([{ companyId: id }]);
    }
  });

  it("refuses to write another company's settings or audit entries", async () => {
    expect(
      await refusal(
        withCompany(app, companyA, (tx) => tx.insert(auditEntries).values(audit(companyB))),
      ),
    ).toMatch(RLS_REFUSAL);
    const changed = await withCompany(app, companyA, (tx) =>
      tx
        .update(companySettings)
        .set({ policyNote: 'تغيير' })
        .where(eq(companySettings.companyId, companyB))
        .returning({ id: companySettings.id }),
    );
    expect(changed).toEqual([]);
  });

  it('shows nothing outside a company transaction, to the app role or the owner', async () => {
    for (const db of [app, owner]) {
      expect(await db.select().from(companySettings)).toEqual([]);
      expect(await db.select().from(auditEntries)).toEqual([]);
    }
  });
});

describe('memberships and invitations', () => {
  it('hold one active membership per person and company; an archived one stays beside a new one', async () => {
    const values = { userId: personId, scopeCompanyId: companyA, role: 'owner' as const };
    const [first] = await app.insert(memberships).values(values).returning({ id: memberships.id });
    expect(await refusal(app.insert(memberships).values(values))).toMatch(/memberships_active_key/);
    if (!first) throw new Error('no membership inserted');
    await app
      .update(memberships)
      .set({ archivedAt: new Date(), archivedReason: 'سبب تجريبي' })
      .where(eq(memberships.id, first.id));
    await app.insert(memberships).values(values);
  });

  it('give the period permission to an accountant only', async () => {
    const someone = await person('person.two@example.test');
    expect(
      await refusal(
        app.insert(memberships).values({
          userId: someone,
          scopeCompanyId: companyA,
          role: 'viewer',
          canClosePeriods: true,
        }),
      ),
    ).toMatch(/memberships_period_permission_accountant_only/);
    await app.insert(memberships).values({
      userId: someone,
      scopeCompanyId: companyA,
      role: 'accountant',
      canClosePeriods: true,
    });
  });

  it('archive a membership only with its reason', async () => {
    expect(
      await refusal(
        app
          .update(memberships)
          .set({ archivedAt: new Date() })
          .where(eq(memberships.userId, personId)),
      ),
    ).toMatch(/memberships_archived_with_reason/);
  });

  it('keep one pending invitation per email and company, and store the email lower-case', async () => {
    const invitation = (identifier: string, email = 'new.member@example.test') => ({
      scopeCompanyId: companyB,
      email,
      role: 'accountant' as const,
      invitedByUserId: personId,
      verificationIdentifier: identifier,
      expiresAt: new Date('2026-11-02T09:00:00Z'),
    });
    await app.insert(invitations).values(invitation('invite:a'));
    expect(await refusal(app.insert(invitations).values(invitation('invite:b')))).toMatch(
      /invitations_pending_key/,
    );
    expect(
      await refusal(app.insert(invitations).values(invitation('invite:c', 'New@Example.test'))),
    ).toMatch(/invitations_email_shape/);
    await app
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(eq(invitations.verificationIdentifier, 'invite:a'));
    await app.insert(invitations).values(invitation('invite:b'));
  });

  it('let the server command create a company and invite its first owner, with no person behind them', async () => {
    const [made] = await app
      .insert(companies)
      .values({ name: 'شركة أولى', createdByUserId: null })
      .returning({ id: companies.id });
    if (!made) throw new Error('no company inserted');
    await app.insert(invitations).values({
      scopeCompanyId: made.id,
      email: 'first.owner@example.test',
      role: 'owner',
      invitedByUserId: null,
      verificationIdentifier: 'invite:first-owner',
      expiresAt: new Date('2026-11-02T09:00:00Z'),
    });
  });

  it('never delete a membership, an invitation, a person or a company', async () => {
    for (const table of [memberships, invitations, users, companies]) {
      expect(await refusal(app.delete(table))).toMatch(DENIED);
    }
  });
});

describe('the ephemeral tables', () => {
  it('let the app role delete an ended session', async () => {
    const [session] = await app
      .insert(sessions)
      .values({
        token: 'token-synthetic',
        userId: personId,
        expiresAt: new Date('2026-10-26T21:00:00Z'),
        ipAddress: '192.0.2.10',
        activeCompanyId: companyA,
      })
      .returning({ id: sessions.id });
    if (!session) throw new Error('no session inserted');
    const deleted = await app
      .delete(sessions)
      .where(eq(sessions.id, session.id))
      .returning({ id: sessions.id });
    expect(deleted).toEqual([session]);
  });

  it('keep a platform audit entry when its session is deleted: the id has no foreign key', async () => {
    const [session] = await app
      .insert(sessions)
      .values({
        token: 'token-audited',
        userId: personId,
        expiresAt: new Date('2026-10-26T21:00:00Z'),
      })
      .returning({ id: sessions.id });
    if (!session) throw new Error('no session inserted');
    await app.insert(platformAuditEntries).values({
      actorKind: 'person',
      actorUserId: personId,
      action: 'user.signed_out',
      sessionId: session.id,
      requestId: 'request-synthetic',
    });
    await app.delete(sessions).where(eq(sessions.id, session.id));
    const kept = await app
      .select({ action: platformAuditEntries.action })
      .from(platformAuditEntries)
      .where(eq(platformAuditEntries.sessionId, session.id));
    expect(kept).toEqual([{ action: 'user.signed_out' }]);
  });
});
