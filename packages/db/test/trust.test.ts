import { type CompanyLedgers, EXPORT_STATES } from '@vertex-mizan/contracts';
import { asc, eq, type SQL, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  COMPANY_EXPORT_STATES,
  chainAnchors,
  chartAccounts,
  companyExports,
  createCompanyBooks,
  emailOutbox,
  journalEntries,
  type PersonActor,
  post,
  recordRate,
  type Transaction,
  users,
  withCompany,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// S03's trust module on the migrated database (0016, 0017): the anchors, append-only and true to
// the chain, the exports' states, and what the jobs role reaches across companies. All values are
// synthetic.

const { app, jobs, owner } = connect();

const SYP_USD: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

let person = '';
const actor = (): PersonActor => ({
  kind: 'person',
  userId: person,
  name: 'مالك تجريبي',
  sessionId: null,
  requestId: 'request-trust-test',
  ipAddress: null,
  userAgent: null,
});

/** A company with Vertex Media's ledgers, its rates of 2026-11-08 and `entries` posted today. */
async function companyWith(entries: number): Promise<string> {
  const id = uuidv7();
  await withCompany(app, id, async (tx) => {
    await createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة ثقة تجريبية',
        nameLatin: null,
        ledgers: SYP_USD,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'service-agency',
        createdByUserId: person,
      },
      actor(),
    );
    for (const [type, rate] of [
      ['bulletin', '121.5000'],
      ['market', '122.0000'],
    ] as const) {
      await recordRate(tx, id, actor(), {
        effectiveOn: '2026-11-08',
        base: 'USD',
        quote: 'SYP',
        rate,
        type,
        source: 'manual',
      });
    }
  });
  for (let n = 0; n < entries; n += 1) await withCompany(app, id, (tx) => postOne(tx, id));
  return id;
}

async function postOne(tx: Transaction, companyId: string) {
  const accounts = new Map(
    (await tx.select({ id: chartAccounts.id, code: chartAccounts.code }).from(chartAccounts)).map(
      (row) => [row.code, row.id],
    ),
  );
  const line = (code: string, amountMinor: bigint) => ({
    accountId: accounts.get(code) as string,
    dimensionValueIds: [],
    currency: 'SYP' as const,
    amountMinor,
    memo: null,
  });
  return post(tx, {
    client: 'manual',
    idempotencyKey: uuidv7(),
    entryDate: '2026-11-08',
    description: `قيد تجريبي ${companyId.slice(-4)}`,
    reference: null,
    draftId: null,
    preparedByUserId: person,
    approvedByUserId: null,
    actor: actor(),
    content: {
      kind: 'manual',
      today: '2026-11-30',
      dealtRates: [],
      lines: [line('111003', 50_000n), line('111001', -50_000n)],
    },
  });
}

const chainOf = (companyId: string) =>
  withCompany(app, companyId, (tx) =>
    tx
      .select({
        id: journalEntries.id,
        sequence: journalEntries.sequence,
        hash: journalEntries.hash,
      })
      .from(journalEntries)
      .orderBy(asc(journalEntries.sequence)),
  );

const TODAY = sql`(now() at time zone 'Asia/Damascus')::date`;

/** An anchor as the daily anchor job writes it, as the jobs role. */
const anchor = (
  companyId: string,
  head: { id: string; sequence: bigint; hash: string },
  values: { anchoredOn?: SQL } = {},
) =>
  jobs.insert(chainAnchors).values({
    companyId,
    anchoredOn: TODAY,
    entryCount: head.sequence,
    headEntryId: head.id,
    headHash: head.hash,
    emailOutboxIds: [uuidv7()],
    ...values,
  });

let company = '';
let chain: { id: string; sequence: bigint; hash: string }[] = [];

beforeAll(async () => {
  const [row] = await app
    .insert(users)
    .values({ email: 'trust.owner@example.test', name: 'مالك تجريبي' })
    .returning({ id: users.id });
  person = row?.id as string;
  company = await companyWith(3);
  chain = await chainOf(company);
});

describe('chain_anchors', () => {
  it('takes the head of the chain at the end of a day, once per company and day', async () => {
    const other = await companyWith(1);
    const [head] = await chainOf(other);
    await anchor(other, head as (typeof chain)[number]);
    expect(await refusal(anchor(other, head as (typeof chain)[number]))).toMatch(
      /chain_anchors_day_key/,
    );
    const stored = await withCompany(app, other, (tx) => tx.select().from(chainAnchors));
    expect(stored).toEqual([
      expect.objectContaining({ companyId: other, entryCount: 1n, headHash: head?.hash }),
    ]);
  });

  it('refuses an anchor that is not the head: another hash, an earlier entry, a later day', async () => {
    const head = chain[2] as (typeof chain)[number];
    const NOT_HEAD = /not the head of the chain/;
    expect(await refusal(anchor(company, { ...head, hash: 'f'.repeat(64) }))).toMatch(NOT_HEAD);
    // Entry 3 was posted today too, so entry 2 was not the head at the end of the day.
    expect(await refusal(anchor(company, chain[1] as (typeof chain)[number]))).toMatch(NOT_HEAD);
    expect(await refusal(anchor(company, { ...head, id: (chain[1] as typeof head).id }))).toMatch(
      NOT_HEAD,
    );
    // Yesterday ended before any entry was posted.
    expect(await refusal(anchor(company, head, { anchoredOn: sql`${TODAY} - 1` }))).toMatch(
      NOT_HEAD,
    );
    expect(await refusal(anchor(company, head, { anchoredOn: sql`${TODAY} + 1` }))).toMatch(
      /has not begun/,
    );
  });

  it('is written by the jobs role only and never changed or removed by any role', async () => {
    const head = chain[2] as (typeof chain)[number];
    expect(
      await refusal(
        withCompany(app, company, (tx) =>
          tx.insert(chainAnchors).values({
            companyId: company,
            anchoredOn: TODAY,
            entryCount: head.sequence,
            headEntryId: head.id,
            headHash: head.hash,
            emailOutboxIds: [],
          }),
        ),
      ),
    ).toMatch(/permission denied/);
    await anchor(company, head);
    for (const db of [jobs, app]) {
      expect(
        await refusal(
          withCompany(db, company, (tx) => tx.update(chainAnchors).set({ headHash: head.hash })),
        ),
      ).toMatch(/permission denied/);
      expect(await refusal(withCompany(db, company, (tx) => tx.delete(chainAnchors)))).toMatch(
        /permission denied/,
      );
    }
    for (const statement of [
      sql`update chain_anchors set entry_count = 1`,
      sql`delete from chain_anchors`,
      sql`truncate chain_anchors`,
    ]) {
      expect(await refusal(withCompany(owner, company, (tx) => tx.execute(statement)))).toMatch(
        /append-only/,
      );
    }
  });
});

describe('company_exports', () => {
  const states = (id: string) =>
    withCompany(app, company, (tx) =>
      tx
        .select({ state: companyExports.state })
        .from(companyExports)
        .where(eq(companyExports.id, id))
        .then(([row]) => row?.state),
    );
  const request = () =>
    withCompany(app, company, (tx) =>
      tx
        .insert(companyExports)
        .values({ companyId: company, requestedByUserId: person })
        .returning({ id: companyExports.id })
        .then(([row]) => row?.id as string),
    );
  const change = (id: string, values: Partial<typeof companyExports.$inferInsert>) =>
    withCompany(app, company, (tx) =>
      tx.update(companyExports).set(values).where(eq(companyExports.id, id)),
    );
  const ready = (id: string, expiresAt: Date) => ({
    state: 'ready',
    storageKey: `${company}/${id}`,
    sizeBytes: 2048,
    sha256: 'c'.repeat(64),
    expiresAt,
  });

  it('keeps the states of the contracts', () => {
    expect(COMPANY_EXPORT_STATES).toEqual(EXPORT_STATES);
  });

  it('queues one export at a time, requested as queued', async () => {
    const first = await request();
    expect(await refusal(request())).toMatch(/company_exports_one_queued_key/);
    expect(
      await refusal(
        withCompany(app, company, (tx) =>
          tx.insert(companyExports).values({
            companyId: company,
            requestedByUserId: person,
            ...ready(uuidv7(), new Date()),
          }),
        ),
      ),
    ).toMatch(/requested queued/);
    await change(first, { state: 'failed', error: 'ENOSPC' });
    expect(await states(first)).toBe('failed');
    expect(await refusal(change(first, { state: 'queued', error: null }))).toMatch(
      /failed to queued refused/,
    );
  });

  it('becomes ready with its file, then expired past its time, keeping the file’s record', async () => {
    const id = await request();
    expect(await refusal(change(id, { state: 'ready' }))).toMatch(/company_exports_ready_fields/);
    expect(
      await refusal(change(id, { ...ready(id, new Date()), storageKey: `${company}/${uuidv7()}` })),
    ).toMatch(/company_exports_storage_key/);
    const future = new Date(Date.now() + 24 * 3600 * 1000);
    await change(id, ready(id, future));
    expect(await refusal(change(id, { state: 'expired' }))).toMatch(/past its time/);
    expect(await refusal(change(id, { requestedByUserId: uuidv7() }))).toMatch(/identity/);

    const past = await request();
    await change(past, ready(past, new Date(Date.now() - 1000)));
    expect(await refusal(change(past, { state: 'expired', sha256: 'd'.repeat(64) }))).toMatch(
      /past its time, as it was/,
    );
    await change(past, { state: 'expired' });
    expect(await states(past)).toBe('expired');
    expect(await refusal(change(past, { state: 'ready' }))).toMatch(/expired to ready refused/);
    expect(await refusal(withCompany(app, company, (tx) => tx.delete(companyExports)))).toMatch(
      /permission denied/,
    );
  });
});

describe('the jobs role', () => {
  it('reads every company’s chain heads and exports, by their granted columns only', async () => {
    const other = await companyWith(1);
    const heads = await jobs
      .select({ companyId: journalEntries.companyId, sequence: journalEntries.sequence })
      .from(journalEntries);
    expect(heads.map((row) => row.companyId)).toEqual(expect.arrayContaining([company, other]));
    expect(
      await jobs
        .select({ id: companyExports.id, state: companyExports.state })
        .from(companyExports)
        .then((rows) => rows.length),
    ).toBeGreaterThan(0);
    for (const statement of [
      'select description from journal_entries',
      'select storage_key from company_exports',
      'select * from journal_lines',
      'select * from entry_drafts',
      'select * from audit_entries',
      'select head_hash from chain_anchors',
      'select name from users',
      'select policy_note from company_settings',
      'select * from email_outbox',
      "update companies set name = 'x'",
      "update company_exports set state = 'failed', error = 'X'",
    ]) {
      expect(await refusal(jobs.$client.query(statement)), statement).toMatch(/permission denied/);
    }
  });

  it('queues an email with its own columns only', async () => {
    const id = uuidv7();
    // Its grant names four columns: the job lists them, and the others take their defaults.
    await jobs.execute(
      sql`insert into email_outbox (id, kind, recipient, data)
          values (${id}, 'daily_anchor', 'trust.owner@example.test', '{"anchors": []}')`,
    );
    const queued = await app.select().from(emailOutbox).where(eq(emailOutbox.id, id));
    expect(queued).toEqual([expect.objectContaining({ kind: 'daily_anchor', attempts: 0 })]);
    expect(
      await refusal(
        jobs.$client.query(
          `insert into email_outbox (id, kind, recipient, data, attempts) values ($1, 'daily_anchor', 'a@example.test', '{}', 5)`,
          [uuidv7()],
        ),
      ),
    ).toMatch(/permission denied/);
  });
});
