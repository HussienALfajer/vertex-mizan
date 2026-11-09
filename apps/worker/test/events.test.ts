import {
  type CompanyLedgers,
  emailDataSchemas,
  eventExamplesV1,
  parseEventEnvelope,
} from '@vertex-mizan/contracts';
import {
  type AuditActor,
  createCompanyBooks,
  createDatabase,
  type Database,
  emailOutbox,
  inboundEventStates,
  memberships,
  type PersonActor,
  receiveEvent,
  recordRate,
  setBulletinDaysOff,
  users,
  withCompany,
} from '@vertex-mizan/db';
import { and, eq, like } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { todayInDamascus } from '../src/core/clock/today.js';
import { type Config, loadConfig } from '../src/core/config/config.js';
import { renderEmail } from '../src/jobs/email/templates.js';
import { EventsHeldDigestJob } from '../src/jobs/events/held-digest.job.js';
import { EventsRetryJob } from '../src/jobs/events/retry.job.js';
import { EventsRetrySweepJob } from '../src/jobs/events/retry-sweep.job.js';

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
const receive = (companyId: string, type: string, clientId = uuidv7()) =>
  withCompany(db, companyId, (tx) => {
    const raw = example(type);
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
    // A milestone holds NO_MAPPING until S06 brings its rule: the sweep leaves it held.
    const milestone = await receive(companyId, 'milestone.done', clientId);
    await sweep.run();
    expect(await stateOf(companyId, milestone.event.inboxId)).toEqual({
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
    await receive(companyId, 'milestone.done');
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
    // A second run on the same day queues nothing; a company with nothing held gets nothing.
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
  });
});
