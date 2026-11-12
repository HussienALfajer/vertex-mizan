import {
  type CompanyLedgers,
  emailDataSchemas,
  eventExamplesV1,
  openingSnapshotExampleV1,
  openingSnapshotKeyV1,
  parseEventEnvelope,
} from '@vertex-mizan/contracts';
import {
  type AuditActor,
  apiClients,
  companySettings,
  createCompanyBooks,
  createDatabase,
  type Database,
  emailOutbox,
  inboundEventStates,
  memberships,
  type PersonActor,
  receiveEvent,
  receiveOpeningSnapshot,
  recordRate,
  reopenPeriod,
  setBulletinDaysOff,
  users,
  withCompany,
} from '@vertex-mizan/db';
import { closeMonthByHand } from '@vertex-mizan/db/testing';
import { and, eq, like, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { todayInDamascus } from '../src/core/clock/today.js';
import { type Config, loadConfig } from '../src/core/config/config.js';
import { EmailSendJob } from '../src/jobs/email/send.job.js';
import { renderEmail } from '../src/jobs/email/templates.js';
import { EventsHeldDigestJob } from '../src/jobs/events/held-digest.job.js';
import { EventsRetryJob } from '../src/jobs/events/retry.job.js';
import { EventsRetrySweepJob } from '../src/jobs/events/retry-sweep.job.js';
import { CleanUpJob } from '../src/jobs/system/clean-up.job.js';
import { CapturingTransport } from './worker.js';

// S05's inbox jobs on the run's database, run directly: the retries the API queues after a
// commit, the daily sweep, and the daily digest of held events, each across companies as the jobs
// role and worked as the app role in each company. All people, companies and amounts are synthetic.

let db: Database;
let jobs: Database;
let config: Config;

const SYP_USD: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

const people = { owner: '', accountant: '', viewer: '' };

const actor = (): PersonActor => ({
  kind: 'person',
  userId: people.owner,
  name: 'مالك تجريبي',
  sessionId: null,
  requestId: 'request-worker-events-test',
  ipAddress: null,
  userAgent: null,
});

const hub = (clientId: string): AuditActor => ({
  kind: 'api_client',
  clientId,
  name: 'Vertex Hub',
  requestId: 'request-worker-events-test',
  ipAddress: null,
  userAgent: null,
});

const today = todayInDamascus();
const examples = eventExamplesV1(today);
const example = (type: string) => {
  const found = examples.find((event) => event.type === type);
  if (!found) throw new Error(`No example of ${type}`);
  return found;
};

/** A company with the service-agency chart, today's rates, and its owner, accountant and viewer. */
async function company(): Promise<string> {
  const id = uuidv7();
  await withCompany(db, id, async (tx) => {
    await createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة أحداث تجريبية',
        nameLatin: null,
        ledgers: SYP_USD,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'service-agency',
        createdByUserId: people.owner,
      },
      actor(),
    );
    await setBulletinDaysOff(tx, id, actor(), []);
    for (const [type, rate] of [
      ['bulletin', '121.5000'],
      ['market', '122.0000'],
    ] as const) {
      await recordRate(tx, id, actor(), {
        effectiveOn: today,
        base: 'USD',
        quote: 'SYP',
        rate,
        type,
        source: 'manual',
      });
    }
  });
  await db.insert(memberships).values([
    { userId: people.owner, scopeCompanyId: id, role: 'owner' },
    { userId: people.accountant, scopeCompanyId: id, role: 'accountant' },
    { userId: people.viewer, scopeCompanyId: id, role: 'viewer' },
  ]);
  return id;
}

/** Hub's event received and attempted in the company, as `POST /v1/events` does. */
const receive = (
  companyId: string,
  type: string,
  clientId = uuidv7(),
  edit: (raw: ReturnType<typeof example>) => ReturnType<typeof example> = (raw) => raw,
) =>
  withCompany(db, companyId, (tx) => {
    const raw = edit(example(type));
    return receiveEvent(
      tx,
      companyId,
      {
        raw: raw as unknown as Record<string, unknown>,
        envelope: parseEventEnvelope(raw),
        apiClientId: clientId,
        requestId: 'request-worker-events-test',
      },
      { actor: hub(clientId), today },
    );
  });

/**
 * An invoice of its own with a tax on its line: held `NO_MAPPING` (`tax_lines`) while taxes are not
 * posted (S05 "Out"), so no retry posts it.
 */
const taxed = (raw: ReturnType<typeof example>): ReturnType<typeof example> => {
  const payload = raw.payload as Record<string, unknown> & { lines: Record<string, unknown>[] };
  return {
    ...raw,
    id: uuidv7(),
    payload: {
      ...payload,
      invoice: { id: uuidv7(), number: 'INV-TAX-1' },
      lines: payload.lines.map((line) => ({
        ...line,
        id: uuidv7(),
        taxes: [{ code: 'VAT', base: 50_000, rate: '5', amount: 2_500 }],
      })),
    },
  } as ReturnType<typeof example>;
};

const stateOf = (companyId: string, inboxId: string) =>
  withCompany(db, companyId, async (tx) => {
    const [row] = await tx
      .select({ state: inboundEventStates.state, reason: inboundEventStates.holdReason })
      .from(inboundEventStates)
      .where(eq(inboundEventStates.eventId, inboxId));
    return row;
  });

beforeAll(async () => {
  db = createDatabase(inject('appUrl'));
  jobs = createDatabase(inject('jobsUrl'));
  config = loadConfig({
    DATABASE_QUEUE_URL: inject('queueUrl'),
    DATABASE_APP_URL: inject('appUrl'),
    DATABASE_JOBS_URL: inject('jobsUrl'),
    APP_URL: 'https://mizan.example.test',
    SMTP_URL: 'smtp://127.0.0.1:1',
    EMAIL_FROM: 'Mizan <mizan@example.test>',
    NODE_ENV: 'test',
  });
  for (const key of Object.keys(people) as (keyof typeof people)[]) {
    const [row] = await db
      .insert(users)
      .values({ email: `worker.events.${key}.${uuidv7()}@example.test`, name: 'شخص تجريبي' })
      .returning({ id: users.id });
    people[key] = row?.id as string;
  }
});
afterAll(async () => {
  await db.$client.end();
  await jobs.$client.end();
});

describe('events.retry', () => {
  it('posts the held events an event frees, and does nothing the second time', async () => {
    const companyId = await company();
    const clientId = uuidv7();
    const payment = await receive(companyId, 'payment.recorded', clientId);
    expect(payment.event).toMatchObject({ state: 'held', reason: 'UNKNOWN_REFERENCE' });
    const invoice = await receive(companyId, 'invoice.issued', clientId);
    expect(invoice.event.state).toBe('posted');
    expect(invoice.triggers.length).toBeGreaterThan(0);
    const job = new EventsRetryJob(db);
    const data = { companyId, triggers: invoice.triggers };
    expect(await job.work(data)).toEqual({ posted: 1 });
    expect(await stateOf(companyId, payment.event.inboxId)).toEqual({
      state: 'posted',
      reason: null,
    });
    expect(await job.work(data)).toEqual({ posted: 0 });
    await expect(job.work({ companyId: 'not-a-company', triggers: [] })).rejects.toThrow();
  });
});

describe('events.retry-sweep', () => {
  it('retries every company’s held events but those the accountant decides, once a day and at start', async () => {
    const companyId = await company();
    const clientId = uuidv7();
    const payment = await receive(companyId, 'payment.recorded', clientId);
    // The invoice posts in a transaction whose retries never ran: the sweep picks the payment up.
    await receive(companyId, 'invoice.issued', clientId);
    const sweep = new EventsRetrySweepJob(jobs, db);
    expect(sweep.runAtStart).toBe(true);
    const first = await sweep.run();
    expect(first.posted).toBeGreaterThanOrEqual(1);
    expect(first.failed).toBe(0);
    expect(await stateOf(companyId, payment.event.inboxId)).toEqual({
      state: 'posted',
      reason: null,
    });
    // A taxed invoice holds NO_MAPPING while taxes are not posted: the sweep leaves it held.
    const held = await receive(companyId, 'invoice.issued', clientId, taxed);
    await sweep.run();
    expect(await stateOf(companyId, held.event.inboxId)).toEqual({
      state: 'held',
      reason: 'NO_MAPPING',
    });
  });
});

describe('events.held-digest', () => {
  it('emails the owners and accountants of a company with held events once a day', async () => {
    const companyId = await company();
    const quiet = await company();
    await receive(companyId, 'payment.recorded');
    await receive(companyId, 'invoice.issued', uuidv7(), taxed);
    const job = new EventsHeldDigestJob(jobs, db, config);
    const day = `2099-${today.slice(5)}`;
    const first = await job.run(day);
    expect(first.queued).toBeGreaterThanOrEqual(2);
    const queued = await db
      .select({
        recipient: emailOutbox.recipient,
        data: emailOutbox.data,
        key: emailOutbox.dedupeKey,
      })
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.kind, 'held_digest'),
          like(emailOutbox.dedupeKey, `held_digest:${companyId}:%`),
        ),
      );
    expect(queued.map((row) => row.recipient).sort()).toEqual(
      [`worker.events.accountant`, `worker.events.owner`].map((prefix) =>
        expect.stringMatching(new RegExp(`^${prefix}\\.`)),
      ),
    );
    const data = emailDataSchemas.held_digest.parse(queued[0]?.data);
    expect(data).toMatchObject({
      companyName: 'شركة أحداث تجريبية',
      day,
      newlyHeld: 2,
      held: [
        { reason: 'NO_MAPPING', count: 1 },
        { reason: 'UNKNOWN_REFERENCE', count: 1 },
      ],
      link: 'https://mizan.example.test/inbox',
    });
    const rendered = renderEmail('held_digest', data, 'owner@example.test');
    expect(rendered.text).toContain('المستند المرجعي لم يصل بعد: 1');
    expect(rendered.text).toContain('لا يوجد ربط بحساب: 1');
    // Sent: the rows stay with their key, so a second run that day, a retry after the send
    // included, queues nothing; a company with nothing held gets nothing.
    const transport = new CapturingTransport();
    await new EmailSendJob(db, transport).run();
    // Sent, with the digests of the earlier tests' companies, whose people are the same two.
    expect(transport.sent.length).toBeGreaterThanOrEqual(2);
    const kept = await db
      .select({ sentAt: emailOutbox.sentAt })
      .from(emailOutbox)
      .where(like(emailOutbox.dedupeKey, `held_digest:${companyId}:${day}:%`));
    expect(kept.map((row) => row.sentAt)).toEqual([expect.any(Date), expect.any(Date)]);
    const again = await job.run(day);
    const forCompany = await db
      .select({ id: emailOutbox.id })
      .from(emailOutbox)
      .where(like(emailOutbox.dedupeKey, `held_digest:${companyId}:${day}:%`));
    expect(forCompany).toHaveLength(2);
    expect(again.queued).toBe(0);
    const none = await db
      .select({ id: emailOutbox.id })
      .from(emailOutbox)
      .where(like(emailOutbox.dedupeKey, `held_digest:${quiet}:%`));
    expect(none).toHaveLength(0);
    // The clean-up deletes a sent digest two days on, never a recent one.
    const [old] = await db
      .update(emailOutbox)
      .set({ sentAt: sql`now() - interval '3 days'` })
      .where(like(emailOutbox.dedupeKey, `held_digest:${companyId}:${day}:%`))
      .returning({ id: emailOutbox.id });
    await new CleanUpJob(db).run();
    const left = await db
      .select({ id: emailOutbox.id })
      .from(emailOutbox)
      .where(like(emailOutbox.dedupeKey, `held_digest:${companyId}:${day}:%`));
    expect(left).toEqual([]);
    expect(old).toBeDefined();
    // The digest reads every company of the run's shared database (S08 rule 16), which the other
    // files fill: its time grows with them, as the property tests' does.
  }, 120_000);

  it('lists the ended months not closed with their failing checklist items (S07 "Jobs")', async () => {
    const companyId = await company();
    const clientId = uuidv7();
    // A payment held before its invoice, and the invoice posted this month; the retry the
    // invoice frees is not run, so the payment stays held.
    await receive(companyId, 'payment.recorded', clientId);
    expect((await receive(companyId, 'invoice.issued', clientId)).event.state).toBe('posted');
    const month = today.slice(0, 7);
    const [year, number] = month.split('-').map(Number) as [number, number];
    const next =
      number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
    const day = `${next}-05`;
    await new EventsHeldDigestJob(jobs, db, config).run(day);
    const [queued] = await db
      .select({ data: emailOutbox.data })
      .from(emailOutbox)
      .where(like(emailOutbox.dedupeKey, `held_digest:${companyId}:${day}:%`));
    const data = emailDataSchemas.held_digest.parse(queued?.data);
    expect(data.unclosedMonths).toEqual([{ period: month, failingItems: expect.any(Number) }]);
    expect(data.unclosedMonths[0]?.failingItems).toBeGreaterThan(0);
    const rendered = renderEmail('held_digest', data, 'owner@example.test');
    expect(rendered.text).toContain('أشهر منتهية غير مقفلة:');
    expect(rendered.text).toContain(`- ${month}: بنود فاشلة في قائمة التحقق قبل الإقفال:`);
  });

  it('lists a company waiting for its opening from the day a snapshot arrives (S10 "Jobs")', async () => {
    const companyId = await company();
    await withCompany(db, companyId, (tx) =>
      tx.update(companySettings).set({ booksStart: '2026-10-01' }),
    );
    const job = new EventsHeldDigestJob(jobs, db, config);
    const digestOf = async (day: string) => {
      await job.run(day);
      const [queued] = await db
        .select({ data: emailOutbox.data })
        .from(emailOutbox)
        .where(like(emailOutbox.dedupeKey, `held_digest:${companyId}:${day}:%`));
      return queued === undefined ? null : emailDataSchemas.held_digest.parse(queued.data);
    };
    // No snapshot yet, nothing else to say: no email.
    expect(await digestOf('2098-01-05')).toBeNull();
    const [client] = await db
      .insert(apiClients)
      .values({
        scopeCompanyId: companyId,
        name: 'Vertex Hub',
        system: 'hub',
        scopes: ['opening:write'],
        createdByUserId: people.owner,
      })
      .returning({ id: apiClients.id });
    const clientId = client?.id as string;
    await withCompany(db, companyId, (tx) =>
      receiveOpeningSnapshot(tx, {
        companyId,
        apiClientId: clientId,
        snapshotKey: openingSnapshotKeyV1('2026-10-01'),
        snapshot: openingSnapshotExampleV1('2026-10-01'),
        actor: hub(clientId),
      }),
    );
    const data = await digestOf('2098-01-06');
    expect(data?.openingLink).toBe('https://mizan.example.test/opening');
    const rendered = renderEmail('held_digest', data as NonNullable<typeof data>, 'o@example.test');
    expect(rendered.text).toContain('الأرصدة الافتتاحية لم تُرحَّل بعد');
    expect(rendered.text).toContain('https://mizan.example.test/opening');
  });

  it('lists the reconciliation days not clean, even with nothing held (S08 rule 16)', async () => {
    const companyId = await company();
    const day = '2099-03-04';
    await db.insert(apiClients).values({
      scopeCompanyId: companyId,
      name: 'Vertex Hub',
      system: 'hub',
      scopes: ['events:write', 'reconciliation:write'],
      reconcileFrom: '2099-03-01',
      createdByUserId: people.owner,
    });
    const job = new EventsHeldDigestJob(jobs, db, config);
    // At 07:00 the 3rd's report is still awaited; at 08:00 it is missing too.
    await job.run(day, `${day}T07:00`);
    await db.delete(emailOutbox).where(like(emailOutbox.dedupeKey, `held_digest:${companyId}:%`));
    await job.run(day, `${day}T08:00`);
    const [queued] = await db
      .select({ data: emailOutbox.data })
      .from(emailOutbox)
      .where(like(emailOutbox.dedupeKey, `held_digest:${companyId}:${day}:%`));
    const data = emailDataSchemas.held_digest.parse(queued?.data);
    expect(data).toMatchObject({
      held: [],
      reconciliation: [
        { date: '2099-03-03', state: 'missing', gaps: 0, afterClose: false },
        { date: '2099-03-02', state: 'missing', gaps: 0, afterClose: false },
        { date: '2099-03-01', state: 'missing', gaps: 0, afterClose: false },
      ],
      reconciliationLink: 'https://mizan.example.test/reconciliation',
    });
    const rendered = renderEmail('held_digest', data, 'owner@example.test');
    expect(rendered.text).toContain('أيام المطابقة غير النظيفة:');
    expect(rendered.text).toContain('- 2099-03-03: لم يصل تقرير Hub');
    expect(rendered.text).toContain('https://mizan.example.test/reconciliation');
    expect(rendered.text).not.toContain('صندوق الوارد');
  }, 120_000);
});

describe('events.retry after a reopen (S07 rule 6)', () => {
  it('posts the events held PERIOD_CLOSED in the reopened month, once', async () => {
    const companyId = await company();
    const month = today.slice(0, 7);
    // The current month closed by hand (the checklist is not this test's), then a Hub event of it.
    await closeMonthByHand(db, companyId, month);
    const invoice = await receive(companyId, 'invoice.issued', uuidv7());
    expect(invoice.event).toMatchObject({ state: 'held', reason: 'PERIOD_CLOSED' });
    const reopened = await withCompany(db, companyId, (tx) =>
      reopenPeriod(tx, { period: month, reason: 'إعادة فتح', today, actor: actor() }),
    );
    expect(reopened.queuedEvents).toBe(1);
    const job = new EventsRetryJob(db);
    const data = { companyId, triggers: reopened.triggers };
    expect(await job.work(data)).toEqual({ posted: 1 });
    expect(await stateOf(companyId, invoice.event.inboxId)).toEqual({
      state: 'posted',
      reason: null,
    });
    expect(await job.work(data)).toEqual({ posted: 0 });
  });
});
