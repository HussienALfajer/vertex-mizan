import {
  auditEntries,
  companies,
  createDatabase,
  type Database,
  emailOutbox,
  invitations,
  rateLimits,
  sessions,
  users,
  verifications,
  withCompany,
} from '@vertex-mizan/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { EmailSendJob, retryDelayMinutes } from '../src/jobs/email/send.job.js';
import { CleanUpJob } from '../src/jobs/system/clean-up.job.js';
import { CapturingTransport } from './worker.js';

// The S01 jobs on the run's database, as the app role: the email outbox and the daily clean-up.
// All people, companies and addresses are synthetic.

let db: Database;

beforeAll(() => {
  db = createDatabase(inject('appUrl'));
});
afterAll(() => db.$client.end());

const HOUR = 60 * 60 * 1000;

describe('email.send', () => {
  let transport: CapturingTransport;
  let job: EmailSendJob;

  beforeEach(async () => {
    await db.delete(emailOutbox);
    transport = new CapturingTransport();
    job = new EmailSendJob(db, transport);
  });

  it('sends each due email in Arabic and deletes it with its token', async () => {
    await db.insert(emailOutbox).values([
      {
        kind: 'invitation',
        recipient: 'new.member@example.test',
        data: {
          companyName: 'شركة اختبار',
          role: 'accountant',
          inviterName: 'شخص تجريبي',
          link: 'https://mizan.example.test/invitation#token=synthetic-invitation-token',
          expiresAt: '2026-11-02T10:00:00.000Z',
        },
      },
      {
        kind: 'password_reset',
        recipient: 'person@example.test',
        data: {
          link: 'https://mizan.example.test/reset-password#token=synthetic-reset-token',
          expiresAt: '2026-10-26T11:00:00.000Z',
        },
      },
      { kind: 'two_factor_reset', recipient: 'member@example.test', data: { companyName: null } },
    ]);
    expect(await job.run()).toEqual({ sent: 3, failed: 0 });
    expect(await db.select().from(emailOutbox)).toEqual([]);
    const [invitation, reset, notice] = transport.sent;
    expect(invitation).toMatchObject({
      to: 'new.member@example.test',
      subject: 'دعوة للانضمام إلى شركة اختبار في ميزان',
    });
    expect(invitation?.text).toContain('بدور المحاسب من شخص تجريبي');
    expect(invitation?.text).toContain('#token=synthetic-invitation-token');
    // 10:00 UTC is 13:00 in Damascus, written with Latin digits.
    expect(invitation?.text).toMatch(/2026.*1:00/);
    expect(invitation?.text).not.toMatch(/[٠-٩]/);
    expect(reset?.text).toContain('#token=synthetic-reset-token');
    expect(notice?.text).toContain('Vertex');
  });

  it('keeps a failed email with its code and tries it again later', async () => {
    const [queued] = await db
      .insert(emailOutbox)
      .values({
        kind: 'two_factor_reset',
        recipient: 'member@example.test',
        data: { companyName: 'شركة اختبار' },
      })
      .returning({ id: emailOutbox.id });
    transport.failNext = 1;
    expect(await job.run()).toEqual({ sent: 0, failed: 1 });
    const [failed] = await db.select().from(emailOutbox);
    expect(failed).toMatchObject({ id: queued?.id, attempts: 1, lastErrorCode: 'ECONNECTION' });
    expect(failed?.sendAfter.getTime()).toBeGreaterThan(Date.now() + 60_000);
    expect(await job.run()).toEqual({ sent: 0, failed: 0 });

    await db.update(emailOutbox).set({ sendAfter: sql`now()` });
    expect(await job.run()).toEqual({ sent: 1, failed: 0 });
    expect(retryDelayMinutes(1)).toBe(2);
    expect(retryDelayMinutes(10)).toBe(60);
  });

  it('keeps an email whose data does not fit its kind, without sending it', async () => {
    await db
      .insert(emailOutbox)
      .values({ kind: 'invitation', recipient: 'a@example.test', data: {} });
    expect(await job.run()).toEqual({ sent: 0, failed: 1 });
    expect(transport.sent).toEqual([]);
    expect((await db.select().from(emailOutbox))[0]?.lastErrorCode).toBe('ZodError');
  });

  it('sends each email once when two runs overlap', async () => {
    await db.insert(emailOutbox).values(
      Array.from({ length: 20 }, (_, n) => ({
        kind: 'two_factor_reset',
        recipient: `member.${n}@example.test`,
        data: { companyName: null },
      })),
    );
    const results = await Promise.all([job.run(), new EmailSendJob(db, transport).run()]);
    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(20);
    expect(new Set(transport.sent.map((email) => email.to)).size).toBe(20);
  });
});

describe('system.clean-up', () => {
  it('deletes what ended, marks expired invitations with an audit row, and finds nothing twice', async () => {
    const [person] = await db
      .insert(users)
      .values({ email: `clean.up.${Date.now()}@example.test`, name: 'شخص تجريبي' })
      .returning({ id: users.id });
    if (!person) throw new Error('no person');
    const [company] = await db
      .insert(companies)
      .values({ name: 'شركة اختبار' })
      .returning({ id: companies.id });
    if (!company) throw new Error('no company');
    const now = Date.now();
    const session = (token: string, expiresAt: number, lastActiveAt: number) => ({
      token,
      userId: person.id,
      expiresAt: new Date(expiresAt),
      lastActiveAt: new Date(lastActiveAt),
    });
    const kept = await db
      .insert(sessions)
      .values([
        session(`expired-${now}`, now - 1000, now - 1000),
        session(`idle-${now}`, now + HOUR, now - 31 * 60 * 1000),
        session(`live-${now}`, now + HOUR, now),
      ])
      .returning({ token: sessions.token });
    await db.insert(verifications).values([
      { identifier: `reset:expired-${now}`, value: person.id, expiresAt: new Date(now - 1000) },
      { identifier: `reset:live-${now}`, value: person.id, expiresAt: new Date(now + HOUR) },
    ]);
    await db.insert(rateLimits).values([
      { key: `mizan:old-${now}`, count: 3, lastRequest: now - 2 * HOUR },
      { key: `mizan:new-${now}`, count: 3, lastRequest: now },
    ]);
    const invited = await db
      .insert(invitations)
      .values([
        {
          scopeCompanyId: company.id,
          email: 'expired.invitation@example.test',
          role: 'viewer',
          verificationIdentifier: `invite:expired-${now}`,
          expiresAt: new Date(now - 1000),
        },
        {
          scopeCompanyId: company.id,
          email: 'live.invitation@example.test',
          role: 'viewer',
          verificationIdentifier: `invite:live-${now}`,
          expiresAt: new Date(now + 7 * 24 * HOUR),
        },
      ])
      .returning({ id: invitations.id, email: invitations.email });

    const job = new CleanUpJob(db);
    const first = await job.run();
    expect(first.invitations).toBe(1);
    expect(first.deleted).toBeGreaterThanOrEqual(4);
    expect(await job.run()).toEqual({ deleted: 0, invitations: 0 });

    const left = await db
      .select({ token: sessions.token })
      .from(sessions)
      .where(
        inArray(
          sessions.token,
          kept.map((row) => row.token),
        ),
      );
    expect(left).toEqual([{ token: `live-${now}` }]);
    expect(
      await db
        .select({ identifier: verifications.identifier })
        .from(verifications)
        .where(inArray(verifications.identifier, [`reset:expired-${now}`, `reset:live-${now}`])),
    ).toEqual([{ identifier: `reset:live-${now}` }]);
    expect(
      await db
        .select({ key: rateLimits.key })
        .from(rateLimits)
        .where(inArray(rateLimits.key, [`mizan:old-${now}`, `mizan:new-${now}`])),
    ).toEqual([{ key: `mizan:new-${now}` }]);
    const states = await db
      .select({ email: invitations.email, revokedAt: invitations.revokedAt })
      .from(invitations)
      .where(eq(invitations.scopeCompanyId, company.id));
    expect(
      states.find((row) => row.email === 'expired.invitation@example.test')?.revokedAt,
    ).not.toBeNull();
    expect(
      states.find((row) => row.email === 'live.invitation@example.test')?.revokedAt,
    ).toBeNull();
    const log = await withCompany(db, company.id, (tx) => tx.select().from(auditEntries));
    expect(log).toEqual([
      expect.objectContaining({
        action: 'invitation.revoked',
        actorKind: 'system',
        entityId: invited.find((row) => row.email === 'expired.invitation@example.test')?.id,
      }),
    ]);
  });
});
