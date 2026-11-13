import {
  type CompanyLedgers,
  DomainError,
  type EventEnvelope,
  money,
  parseEventEnvelope,
  REVENUE_MOVEMENT_KINDS,
} from '@vertex-mizan/contracts';
import { negate, recognitionProblems } from '@vertex-mizan/ledger';
import { and, asc, eq, sql } from 'drizzle-orm';
import fc from 'fast-check';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type AuditActor,
  chartAccounts,
  createCompanyBooks,
  inboundEventActions,
  inboundEventStates,
  inboundEvents,
  journalEntries,
  journalLines,
  mapAppendedTemplateSlots,
  moveEvent,
  openItemBalances,
  openItems,
  type PersonActor,
  post,
  postingRuleAccounts,
  previewAction,
  RECOGNITION_MOVEMENT_KINDS,
  readRecognitionState,
  receiveEvent,
  recogniseEvent,
  recognitionMovements,
  recognitionSchedules,
  recordRate,
  releaseMonth,
  resolveEvent,
  retryEvent,
  retryFreed,
  splitEvent,
  type Transaction,
  users,
  withCompany,
} from '../src/index.js';
import { closeMonthByHand, connect, refusal } from './connections.js';

// S06's over-time recognition on the migrated database (0031–0033): an invoice with a retainer
// cycle's charge deferred, its schedule and movements written beside its entries, the monthly
// release job (twice, and after a late invoice), an elapsed month as a contract asset, a service
// change, a closed elapsed month held and recognised in the first open period, the holds of
// PR 1, the template's new slots for an existing company, and the writes the service never
// makes, forged to prove the guards refuse them. The numbers are `revenue/over-time-release`'s.
// Every value is synthetic.

const { app, owner, superuser } = connect();

let personId = '';

const person = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'محاسب تجريبي',
  sessionId: null,
  requestId: 'request-recognition-test',
  ipAddress: null,
  userAgent: null,
});

const CLIENT_ID = uuidv7();

const hub: AuditActor = {
  kind: 'api_client',
  clientId: CLIENT_ID,
  name: 'Vertex Hub',
  requestId: 'request-recognition-test',
  ipAddress: null,
  userAgent: null,
};

const system: AuditActor = {
  kind: 'system',
  name: 'Vertex',
  requestId: 'job:revenue.release-month',
  ipAddress: null,
  userAgent: null,
};

const SYP_USD: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

const inCompany = <T>(companyId: string, work: (tx: Transaction) => Promise<T>) =>
  withCompany(app, companyId, work);

async function newCompany(bulletins: readonly [string, string][]): Promise<string> {
  const id = uuidv7();
  await withCompany(app, id, async (tx) => {
    await createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة اعتراف تجريبية',
        nameLatin: null,
        ledgers: SYP_USD,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'service-agency',
        createdByUserId: personId,
      },
      person(),
    );
    for (const [on, rate] of bulletins) {
      await recordRate(tx, id, person(), {
        effectiveOn: on,
        base: 'USD',
        quote: 'SYP',
        rate,
        type: 'bulletin',
        source: 'manual',
      });
    }
  });
  return id;
}

const ids = (n: number) => `01934b6e-0000-7000-8000-${String(n).padStart(12, '0')}`;
const C1 = { external_id: ids(9001), code: 'C1', name: 'عميل تجريبي' };
const S1 = { external_id: ids(9002), code: 'S1', name: 'خدمة تجريبية' };
const S2 = { external_id: ids(9003), code: 'S2', name: 'خدمة أخرى' };
const R1 = {
  external_id: ids(9004),
  code: 'R1',
  name: 'اشتراك تجريبي',
  kind: 'retainer',
  client_external_id: C1.external_id,
};

const bodies = new Map<string, Record<string, unknown>>();

function envelope(type: string, on: string, payload: unknown): EventEnvelope {
  const raw = {
    id: uuidv7(),
    type,
    version: 1,
    occurred_at: `${on}T12:00:00+03:00`,
    accounting_date: on,
    payload,
  };
  bodies.set(raw.id, raw);
  return parseEventEnvelope(raw);
}

const invoiceRef = (n: number) => ({ id: ids(100 + n), number: `INV-2026-${n}` });

/** A retainer cycle's monthly charge, as `revenue/over-time-release` writes it. */
const cycle = (n: number, on: string, amount: number, from: string, to: string, extra = {}) =>
  envelope('invoice.issued', on, {
    invoice: invoiceRef(n),
    client: C1,
    contract: R1,
    currency: 'USD',
    syp_per_usd: '122.0000',
    issued_on: on,
    due_on: '2026-12-31',
    lines: [
      {
        id: ids(200 + n),
        amount,
        service: S1,
        source: 'retainer_charge',
        charge_kind: 'monthly',
        cycle_start: from,
        cycle_end: to,
        ...extra,
      },
    ],
  });

async function receive(companyId: string, event: EventEnvelope, today: string) {
  const result = await inCompany(companyId, (tx) =>
    receiveEvent(
      tx,
      companyId,
      {
        raw: bodies.get(event.id) as Record<string, unknown>,
        envelope: event,
        apiClientId: CLIENT_ID,
        requestId: 'request-recognition-test',
      },
      { actor: hub, today },
    ),
  );
  await inCompany(companyId, (tx) => retryFreed(tx, result.triggers, { actor: system, today }));
  return result;
}

/** The job for a month, run on the first day of the next as the scenario's clock does. */
const runJob = (companyId: string, month: string, today: string) =>
  inCompany(companyId, (tx) => releaseMonth(tx, month, today, system));

async function ledger(companyId: string) {
  return inCompany(companyId, async (tx) => {
    const entries = await tx.select().from(journalEntries).orderBy(asc(journalEntries.sequence));
    const lines = await tx
      .select({ line: journalLines, code: chartAccounts.code })
      .from(journalLines)
      .innerJoin(
        chartAccounts,
        and(
          eq(chartAccounts.companyId, journalLines.companyId),
          eq(chartAccounts.id, journalLines.accountId),
        ),
      )
      .orderBy(asc(journalLines.lineNo));
    return entries.map((entry) => ({
      source: entry.source,
      date: entry.entryDate,
      lines: lines
        .filter(({ line }) => line.entryId === entry.id)
        .map(({ line, code }) => [
          code,
          line.currency,
          line.amountMinor,
          line.bookMinor,
          line.parallelMinor,
        ]),
    }));
  });
}

/** Each schedule's remaining, the sum of its movements in each ledger (ADR 0015). */
async function remaining(companyId: string) {
  return inCompany(companyId, async (tx) => {
    const result = await tx.execute<{ t: string; b: string; p: string | null }>(
      sql`select sum(transaction_minor)::text as t, sum(book_minor)::text as b,
            sum(parallel_minor)::text as p
          from recognition_movements group by schedule_id order by schedule_id`,
    );
    return result.rows.map((row) => [
      BigInt(row.t),
      BigInt(row.b),
      row.p === null ? null : BigInt(row.p),
    ]);
  });
}

async function closePeriod(companyId: string, period: string) {
  await closeMonthByHand(app, companyId, period);
}

/** Waits until a backend of the run's database waits for a lock in a statement on `table`. */
async function waitForLockOn(table: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const waiting = await superuser.query<{ count: string }>(
      `select count(*)::text as count from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock' and query like $1`,
      [`%${table}%`],
    );
    if (Number(waiting.rows[0]?.count ?? 0) > 0) return;
    if (Date.now() > deadline) throw new Error(`No statement waits for a lock on ${table}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

beforeAll(async () => {
  const [row] = await app
    .insert(users)
    .values({ email: `recognition-${uuidv7()}@example.test`, name: 'محاسب تجريبي' })
    .returning({ id: users.id });
  personId = row?.id as string;
});

describe('a retainer cycle released over its days (S06 rules 2–5)', () => {
  it('defers 900.00 USD at 121, releases 16/30 and 14/30, and a second run posts nothing', async () => {
    const company = await newCompany([['2026-11-15', '121.0000']]);
    const invoice = await receive(
      company,
      cycle(20, '2026-11-15', 90_000, '2026-11-15', '2026-12-14'),
      '2026-11-15',
    );
    expect(invoice.event).toMatchObject({ state: 'posted' });
    // The current month is never released before it ends.
    expect(await runJob(company, '2026-11', '2026-11-30')).toEqual({ posted: 0, refused: [] });
    expect(await runJob(company, '2026-11', '2026-12-01')).toEqual({ posted: 1, refused: [] });
    expect(await runJob(company, '2026-11', '2026-12-01')).toEqual({ posted: 0, refused: [] });
    expect(await runJob(company, '2026-12', '2027-01-01')).toEqual({ posted: 1, refused: [] });
    expect(await ledger(company)).toEqual([
      {
        source: 'hub_event',
        date: '2026-11-15',
        lines: [
          ['112001', 'USD', 90_000n, 10_890_000n, 90_000n],
          ['212001', 'USD', -90_000n, -10_890_000n, -90_000n],
        ],
      },
      {
        source: 'revenue_release',
        date: '2026-11-30',
        lines: [
          ['212001', 'USD', 48_000n, 5_808_000n, 48_000n],
          ['411001', 'USD', -48_000n, -5_808_000n, -48_000n],
        ],
      },
      {
        source: 'revenue_release',
        date: '2026-12-31',
        lines: [
          ['212001', 'USD', 42_000n, 5_082_000n, 42_000n],
          ['411001', 'USD', -42_000n, -5_082_000n, -42_000n],
        ],
      },
    ]);
    expect(await remaining(company)).toEqual([[0n, 0n, 0n]]);
    const [schedule] = await inCompany(company, (tx) => tx.select().from(recognitionSchedules));
    expect(schedule).toMatchObject({
      pattern: 'over_time',
      lineSource: 'retainer_charge',
      chargeKind: 'monthly',
      cycleKey: `${R1.external_id}:2026-11-15`,
      serviceFrom: '2026-11-15',
      serviceTo: '2026-12-14',
      invoiceNumber: 'INV-2026-20',
    });
    const movements = await inCompany(company, (tx) =>
      tx.select().from(recognitionMovements).orderBy(asc(recognitionMovements.createdAt)),
    );
    expect(movements.map((m) => [m.kind, m.month, m.transactionMinor])).toEqual([
      ['deferred', null, 90_000n],
      ['released', '2026-11-01', -48_000n],
      ['released', '2026-12-01', -42_000n],
    ]);
    // The releases are the system's, with the invoice as their Hub document.
    const releases = await inCompany(company, (tx) =>
      tx
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.source, 'revenue_release'))
        .orderBy(asc(journalEntries.sequence)),
    );
    expect(releases.map((entry) => [entry.description, entry.postedByClientId])).toEqual([
      ['تحرير إيراد INV-2026-20 عن 2026-11', null],
      ['تحرير إيراد INV-2026-20 عن 2026-12', null],
    ]);
  });

  it('releases an ended month in the transaction of an invoice received after its job', async () => {
    const company = await newCompany([['2026-11-19', '121.0000']]);
    expect(await runJob(company, '2026-11', '2026-12-01')).toEqual({ posted: 0, refused: [] });
    await receive(
      company,
      cycle(25, '2026-11-19', 60_000, '2026-11-19', '2026-12-18'),
      '2026-12-01',
    );
    expect(await runJob(company, '2026-11', '2026-12-01')).toEqual({ posted: 0, refused: [] });
    const entries = await ledger(company);
    expect(entries.map((entry) => [entry.source, entry.date, entry.lines[0]?.[2]])).toEqual([
      ['hub_event', '2026-11-19', 60_000n],
      ['revenue_release', '2026-11-30', 24_000n],
    ]);
    expect(entries[1]?.lines[0]).toEqual(['212001', 'USD', 24_000n, 2_904_000n, 24_000n]);
  });

  it('recognises a late issue’s elapsed October at 119 and clears it at 120.5 with a 360.00 SYP gain', async () => {
    const company = await newCompany([
      ['2026-10-29', '119.0000'],
      ['2026-11-05', '120.5000'],
    ]);
    await receive(
      company,
      cycle(24, '2026-11-05', 62_000, '2026-10-20', '2026-11-19'),
      '2026-11-05',
    );
    await runJob(company, '2026-11', '2026-12-01');
    expect(await ledger(company)).toEqual([
      {
        source: 'hub_event',
        date: '2026-10-31',
        lines: [
          ['113001', 'USD', 24_000n, 2_856_000n, 24_000n],
          ['411001', 'USD', -24_000n, -2_856_000n, -24_000n],
        ],
      },
      {
        source: 'hub_event',
        date: '2026-11-05',
        lines: [
          ['112001', 'USD', 62_000n, 7_471_000n, 62_000n],
          ['212001', 'USD', -38_000n, -4_579_000n, -38_000n],
          ['113001', 'USD', -24_000n, -2_856_000n, -24_000n],
          ['421001', 'SYP', -36_000n, -36_000n, 0n],
        ],
      },
      {
        source: 'revenue_release',
        date: '2026-11-30',
        lines: [
          ['212001', 'USD', 38_000n, 4_579_000n, 38_000n],
          ['411001', 'USD', -38_000n, -4_579_000n, -38_000n],
        ],
      },
    ]);
    const items = await inCompany(company, (tx) =>
      tx
        .select({ reference: openItems.reference, open: openItemBalances.openMinor })
        .from(openItems)
        .innerJoin(openItemBalances, eq(openItemBalances.itemId, openItems.id))
        .orderBy(asc(openItems.reference)),
    );
    expect(items).toEqual([
      { reference: 'INV-2026-24', open: 62_000n },
      { reference: 'INV-2026-24/1', open: 0n },
    ]);
    expect(await remaining(company)).toEqual([[0n, 0n, 0n]]);
  });

  it('moves what a deferred line released to its new service, and December releases on it', async () => {
    const company = await newCompany([
      ['2026-11-15', '121.0000'],
      ['2026-12-07', '123.0000'],
    ]);
    await receive(
      company,
      cycle(20, '2026-11-15', 90_000, '2026-11-15', '2026-12-14'),
      '2026-11-15',
    );
    await runJob(company, '2026-11', '2026-12-01');
    const changed = await receive(
      company,
      envelope('invoice.line_service_changed', '2026-12-07', {
        invoice: invoiceRef(20),
        line_id: ids(220),
        old_service: S1,
        new_service: S2,
        changed_on: '2026-12-07',
      }),
      '2026-12-07',
    );
    expect(changed.event).toMatchObject({ state: 'posted' });
    await runJob(company, '2026-12', '2027-01-01');
    const entries = await ledger(company);
    expect(entries.slice(2).map((entry) => [entry.source, entry.date, entry.lines])).toEqual([
      [
        'hub_event',
        '2026-12-07',
        [
          ['411001', 'USD', 48_000n, 5_808_000n, 48_000n],
          ['411001', 'USD', -48_000n, -5_808_000n, -48_000n],
        ],
      ],
      [
        'revenue_release',
        '2026-12-31',
        [
          ['212001', 'USD', 42_000n, 5_082_000n, 42_000n],
          ['411001', 'USD', -42_000n, -5_082_000n, -42_000n],
        ],
      ],
    ]);
    // December's release carries S2.
    const services = await inCompany(company, async (tx) => {
      const result = await tx.execute<{ code: string }>(
        sql`select v.code from journal_lines l
            join journal_entries e on e.id = l.entry_id
            join dimension_set_values s on s.set_id = l.dimension_set_id
            join dimension_values v on v.id = s.value_id
            join dimension_types t on t.id = v.type_id and t.code = 'service'
            where e.source = 'revenue_release' order by e.sequence`,
      );
      return result.rows.map((row) => row.code);
    });
    expect(services).toEqual(['S1', 'S2']);
  });
});

describe('the review’s fixes (S05 rule 15, S06 rules 5 and 10; owner, 2026-11-11)', () => {
  it('posts an invoice moved out of a closed month with that month’s release on the first open day', async () => {
    // 620.00 USD for 20 Oct to 19 Nov (31 days), issued on 20 Oct at 119, received after October
    // closed: held PERIOD_CLOSED, then moved to 1 November. October's 12 days release on 1 November
    // at their carried amounts (owner, 2026-11-11); November's 19 with November.
    const company = await newCompany([['2026-10-20', '119.0000']]);
    await closePeriod(company, '2026-10');
    const invoice = await receive(
      company,
      cycle(27, '2026-10-20', 62_000, '2026-10-20', '2026-11-19'),
      '2026-11-05',
    );
    expect(invoice.event).toMatchObject({ state: 'held', reason: 'PERIOD_CLOSED' });
    const moved = await inCompany(company, (tx) =>
      moveEvent(tx, invoice.event.inboxId, 'وصلت الفاتورة بعد إقفال تشرين الأول', {
        actor: person(),
        today: '2026-11-05',
      }),
    );
    expect(moved.event).toMatchObject({ state: 'posted', postedOn: '2026-11-01' });
    await runJob(company, '2026-11', '2026-12-01');
    expect(await ledger(company)).toEqual([
      {
        source: 'hub_event',
        date: '2026-11-01',
        lines: [
          ['112001', 'USD', 62_000n, 7_378_000n, 62_000n],
          ['212001', 'USD', -62_000n, -7_378_000n, -62_000n],
        ],
      },
      {
        source: 'revenue_release',
        date: '2026-11-01',
        lines: [
          ['212001', 'USD', 24_000n, 2_856_000n, 24_000n],
          ['411001', 'USD', -24_000n, -2_856_000n, -24_000n],
        ],
      },
      {
        source: 'revenue_release',
        date: '2026-11-30',
        lines: [
          ['212001', 'USD', 38_000n, 4_522_000n, 38_000n],
          ['411001', 'USD', -38_000n, -4_522_000n, -38_000n],
        ],
      },
    ]);
    // October's release keeps its month on its movement, so it is never released twice.
    const months = await inCompany(company, (tx) =>
      tx
        .select({ month: recognitionMovements.month })
        .from(recognitionMovements)
        .where(eq(recognitionMovements.kind, 'released'))
        .orderBy(asc(recognitionMovements.month)),
    );
    expect(months.map((row) => row.month)).toEqual(['2026-10-01', '2026-11-01']);
    expect(await remaining(company)).toEqual([[0n, 0n, 0n]]);
  });

  it('moves a release dated after a late service change on its own date', async () => {
    // The change is dated 28 November but processed after November's and December's releases on
    // S1: nothing was recognised by 28 November, and each release moves to S2 on its own date.
    const company = await newCompany([['2026-11-15', '121.0000']]);
    await receive(
      company,
      cycle(20, '2026-11-15', 90_000, '2026-11-15', '2026-12-14'),
      '2026-11-15',
    );
    await runJob(company, '2026-11', '2026-12-01');
    await runJob(company, '2026-12', '2027-01-01');
    await receive(
      company,
      envelope('invoice.line_service_changed', '2026-11-28', {
        invoice: invoiceRef(20),
        line_id: ids(220),
        old_service: S1,
        new_service: S2,
        changed_on: '2026-11-28',
      }),
      '2027-01-02',
    );
    const entries = await ledger(company);
    expect(entries.slice(3).map((entry) => [entry.source, entry.date, entry.lines])).toEqual([
      [
        'hub_event',
        '2026-11-30',
        [
          ['411001', 'USD', 48_000n, 5_808_000n, 48_000n],
          ['411001', 'USD', -48_000n, -5_808_000n, -48_000n],
        ],
      ],
      [
        'hub_event',
        '2026-12-31',
        [
          ['411001', 'USD', 42_000n, 5_082_000n, 42_000n],
          ['411001', 'USD', -42_000n, -5_082_000n, -42_000n],
        ],
      ],
    ]);
  });

  it('releases on the service a change committed while the job waited for the ledger head', async () => {
    const company = await newCompany([['2026-11-15', '121.0000']]);
    await receive(
      company,
      cycle(20, '2026-11-15', 90_000, '2026-11-15', '2026-12-14'),
      '2026-11-15',
    );
    await runJob(company, '2026-11', '2026-12-01');
    const change = envelope('invoice.line_service_changed', '2026-12-07', {
      invoice: invoiceRef(20),
      line_id: ids(220),
      old_service: S1,
      new_service: S2,
      changed_on: '2026-12-07',
    });
    let locked: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      locked = resolve;
    });
    let release: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The change holds the ledger head until the job has started; the job then waits for it.
    const changing = inCompany(company, async (tx) => {
      await receiveEvent(
        tx,
        company,
        {
          raw: bodies.get(change.id) as Record<string, unknown>,
          envelope: change,
          apiClientId: CLIENT_ID,
          requestId: 'request-recognition-test',
        },
        { actor: hub, today: '2026-12-07' },
      );
      locked();
      await done;
    });
    await held;
    const job = runJob(company, '2026-12', '2027-01-01');
    // The job is waiting on the ledger head before the change commits: had it read the schedules
    // first, it would release December on S1 (ADR 0008's lock order).
    await waitForLockOn('ledger_heads');
    release();
    await Promise.all([changing, job]);
    const services = await inCompany(company, async (tx) => {
      const result = await tx.execute<{ code: string }>(
        sql`select v.code from journal_lines l
            join journal_entries e on e.id = l.entry_id
            join dimension_set_values s on s.set_id = l.dimension_set_id
            join dimension_values v on v.id = s.value_id
            join dimension_types t on t.id = v.type_id and t.code = 'service'
            where e.source = 'revenue_release' order by e.sequence`,
      );
      return result.rows.map((row) => row.code);
    });
    expect(services).toEqual(['S1', 'S2']);
  });
});

describe('the holds of over-time recognition (S06 rules 1, 7, 8, 16, 18)', () => {
  it('holds a late issue into a closed month SERVICE_PERIOD_CLOSED, then recognises it on 1 Nov', async () => {
    const company = await newCompany([
      ['2026-10-29', '119.0000'],
      ['2026-11-05', '120.5000'],
    ]);
    await closePeriod(company, '2026-10');
    const invoice = await receive(
      company,
      cycle(24, '2026-11-05', 62_000, '2026-10-20', '2026-11-19'),
      '2026-11-05',
    );
    expect(invoice.event).toMatchObject({ state: 'held', reason: 'SERVICE_PERIOD_CLOSED' });
    await expect(
      inCompany(company, (tx) =>
        recogniseEvent(tx, uuidv7(), 'سبب', { actor: person(), today: '2026-11-05' }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const recognised = await inCompany(company, (tx) =>
      recogniseEvent(tx, invoice.event.inboxId, 'وصلت الفاتورة بعد إقفال تشرين الأول', {
        actor: person(),
        today: '2026-11-05',
      }),
    );
    expect(recognised.event).toMatchObject({ state: 'posted' });
    const entries = await ledger(company);
    // October's part on 1 November, still at the bulletin in force on 31 October.
    expect(entries.map((entry) => [entry.date, entry.lines[0]])).toEqual([
      ['2026-11-01', ['113001', 'USD', 24_000n, 2_856_000n, 24_000n]],
      ['2026-11-05', ['112001', 'USD', 62_000n, 7_471_000n, 62_000n]],
    ]);
    const actions = await inCompany(company, (tx) =>
      tx
        .select({ action: inboundEventActions.action, reason: inboundEventActions.reason })
        .from(inboundEventActions)
        .where(eq(inboundEventActions.eventId, invoice.event.inboxId))
        .orderBy(asc(inboundEventActions.createdAt)),
    );
    expect(actions.map((row) => row.action)).toEqual([
      'received',
      'held',
      'recognised_in_open_period',
    ]);
    // A held event of another reason is not recognised.
    const other = await receive(
      company,
      cycle(30, '2026-11-05', 1_000, '2026-11-01', '2026-11-30', { cycle_start: undefined }),
      '2026-11-05',
    );
    expect(other.event).toMatchObject({
      reason: 'NEEDS_DECISION',
      detail: 'recognition_pattern_unclear:1',
    });
    await expect(
      inCompany(company, (tx) =>
        recogniseEvent(tx, other.event.inboxId, 'سبب', { actor: person(), today: '2026-11-05' }),
      ),
    ).rejects.toMatchObject({ code: 'EVENT_ACTION_NOT_ALLOWED' });
  });

  it('leaves a month’s release missing, with its reason, while the revenue slot is unmapped', async () => {
    const company = await newCompany([['2026-11-15', '121.0000']]);
    await receive(
      company,
      cycle(20, '2026-11-15', 90_000, '2026-11-15', '2026-12-14'),
      '2026-11-15',
    );
    await inCompany(company, (tx) =>
      tx
        .update(postingRuleAccounts)
        .set({ archivedAt: sql`now()` })
        .where(eq(postingRuleAccounts.slot, 'released_revenue')),
    );
    expect(await runJob(company, '2026-11', '2026-12-01')).toEqual({
      posted: 0,
      refused: [
        {
          invoiceNumber: 'INV-2026-20',
          code: 'MAPPING_ACCOUNT_INVALID',
          detail: 'slot_unmapped:released_revenue',
        },
      ],
    });
  });
});

/** The integrity check's recognition proof on the company's books (S06 "Data"). */
const proof = (companyId: string) =>
  inCompany(companyId, async (tx) => recognitionProblems(await readRecognitionState(tx)));

/** An invoice of the retainer with extra work and a credit to a cycle (`revenue/retainer-credit`). */
const creditInvoice = (n: number, on: string, extra: number, credit: number, cycleStart: string) =>
  envelope('invoice.issued', on, {
    invoice: invoiceRef(n),
    client: C1,
    contract: R1,
    currency: 'USD',
    syp_per_usd: '122.0000',
    issued_on: on,
    due_on: '2026-12-31',
    lines: [
      { id: ids(300 + n), amount: extra, service: S2, source: 'extra_work' },
      {
        id: ids(400 + n),
        amount: credit,
        service: S1,
        source: 'retainer_charge',
        charge_kind: 'credit',
        cycle_start: cycleStart,
      },
    ],
  });

const voidOf = (n: number, on: string) =>
  envelope('invoice.voided', on, { invoice: invoiceRef(n), voided_on: on, reason: 'أُلغيت في Hub' });

describe('credits, voids and re-issues (S06 rules 6, 8, 9)', () => {
  it('credits a cycle, then its void gives the part back: 16/30 released on the void date, the rest in December', async () => {
    const company = await newCompany([
      ['2026-11-15', '121.0000'],
      ['2026-11-19', '121.0000'],
    ]);
    await receive(
      company,
      cycle(40, '2026-11-15', 90_000, '2026-11-15', '2026-12-14'),
      '2026-11-15',
    );
    const credit = await receive(
      company,
      creditInvoice(46, '2026-11-19', 10_000, -5_000, '2026-11-15'),
      '2026-11-19',
    );
    expect(credit.event).toMatchObject({ state: 'posted' });
    await runJob(company, '2026-11', '2026-12-01');
    const voiding = voidOf(46, '2026-12-03');
    const voided = await receive(company, voiding, '2026-12-03');
    expect(voided.event).toMatchObject({ state: 'posted' });
    // A replay of the void posts nothing new.
    expect((await receive(company, voiding, '2026-12-03')).replayed).toBe(true);
    await runJob(company, '2026-12', '2027-01-01');
    const entries = await ledger(company);
    expect(entries.map((entry) => [entry.source, entry.date])).toEqual([
      ['hub_event', '2026-11-15'],
      ['hub_event', '2026-11-19'],
      ['revenue_release', '2026-11-30'],
      ['hub_event', '2026-12-03'],
      ['hub_event', '2026-12-03'],
      ['revenue_release', '2026-12-31'],
    ]);
    expect(entries[4]?.lines).toEqual([
      ['212001', 'USD', 2_667n, 322_667n, 2_667n],
      ['411001', 'USD', -2_667n, -322_667n, -2_667n],
    ]);
    expect(entries[5]?.lines).toEqual([
      ['212001', 'USD', 42_000n, 5_082_000n, 42_000n],
      ['411001', 'USD', -42_000n, -5_082_000n, -42_000n],
    ]);
    // The cycle is fully released, and the credit's movements were given back.
    expect(await remaining(company)).toEqual([[0n, 0n, 0n]]);
    const credits = await inCompany(company, (tx) =>
      tx
        .select({ creditMinor: recognitionMovements.creditMinor })
        .from(recognitionMovements)
        .where(eq(recognitionMovements.kind, 'credited'))
        .orderBy(asc(recognitionMovements.createdAt), asc(recognitionMovements.id)),
    );
    expect(credits).toEqual([{ creditMinor: 5_000n }, { creditMinor: -5_000n }]);
    expect(await proof(company)).toEqual([]);
  });

  it('holds a credit before its cycle UNKNOWN_REFERENCE, and posts it once the cycle’s invoice posts', async () => {
    const company = await newCompany([
      ['2026-11-15', '121.0000'],
      ['2026-11-19', '121.0000'],
    ]);
    const early = await receive(
      company,
      creditInvoice(46, '2026-11-19', 10_000, -5_000, '2026-11-15'),
      '2026-11-19',
    );
    expect(early.event).toMatchObject({
      state: 'held',
      reason: 'UNKNOWN_REFERENCE',
      detail: 'credit_cycle',
    });
    const issued = await receive(
      company,
      cycle(40, '2026-11-15', 90_000, '2026-11-15', '2026-12-14'),
      '2026-11-19',
    );
    expect(issued.triggers).toContainEqual({ kind: 'cycle' });
    const [state] = await inCompany(company, (tx) =>
      tx
        .select({ state: inboundEventStates.state })
        .from(inboundEventStates)
        .where(eq(inboundEventStates.eventId, early.event.inboxId)),
    );
    expect(state).toEqual({ state: 'posted' });
    expect(await remaining(company)).toEqual([[85_000n, 10_285_000n, 85_000n]]);
    expect(await proof(company)).toEqual([]);
  });

  it('posts the ended month’s release in the credit’s transaction, so the job posts nothing after', async () => {
    const company = await newCompany([
      ['2026-11-03', '120.0000'],
      ['2026-12-01', '123.0000'],
    ]);
    await receive(
      company,
      cycle(42, '2026-11-03', 60_000, '2026-11-01', '2026-11-30'),
      '2026-11-03',
    );
    await receive(
      company,
      creditInvoice(43, '2026-12-01', 60_000, -6_000, '2026-11-01'),
      '2026-12-01',
    );
    expect(await runJob(company, '2026-11', '2026-12-01')).toEqual({ posted: 0, refused: [] });
    const entries = await ledger(company);
    expect(entries.map((entry) => [entry.source, entry.date])).toEqual([
      ['hub_event', '2026-11-03'],
      ['revenue_release', '2026-11-30'],
      ['hub_event', '2026-12-01'],
    ]);
    // All of it reduces revenue at 123: the cycle was fully released first.
    expect(entries[2]?.lines).toContainEqual(['411001', 'USD', 6_000n, 738_000n, 6_000n]);
    expect(await proof(company)).toEqual([]);
  });

  it('reverses a released cycle latest first, re-issues it with November at issue, and holds a credited cycle’s void', async () => {
    const company = await newCompany([
      ['2026-11-15', '121.0000'],
      ['2026-11-19', '121.0000'],
      ['2026-12-07', '122.0000'],
    ]);
    await receive(
      company,
      cycle(80, '2026-11-15', 90_000, '2026-11-15', '2026-12-14'),
      '2026-11-15',
    );
    await runJob(company, '2026-11', '2026-12-01');
    await receive(company, voidOf(80, '2026-12-03'), '2026-12-03');
    await receive(
      company,
      cycle(81, '2026-12-07', 90_000, '2026-11-15', '2026-12-14'),
      '2026-12-07',
    );
    const entries = await ledger(company);
    expect(entries.slice(2, 5).map((entry) => entry.lines)).toEqual([
      [
        ['212001', 'USD', -48_000n, -5_808_000n, -48_000n],
        ['411001', 'USD', 48_000n, 5_808_000n, 48_000n],
      ],
      [
        ['112001', 'USD', -90_000n, -10_890_000n, -90_000n],
        ['212001', 'USD', 90_000n, 10_890_000n, 90_000n],
      ],
      [
        ['112001', 'USD', 90_000n, 10_980_000n, 90_000n],
        ['411001', 'USD', -48_000n, -5_856_000n, -48_000n],
        ['212001', 'USD', -42_000n, -5_124_000n, -42_000n],
      ],
    ]);
    const schedules = await inCompany(company, (tx) =>
      tx.select().from(recognitionSchedules).orderBy(asc(recognitionSchedules.createdAt)),
    );
    expect(schedules[1]?.reissueOfScheduleId).toBe(schedules[0]?.id);
    // The voided schedule holds nothing, the re-issue December's 420.00 USD.
    expect(await remaining(company)).toEqual([
      [0n, 0n, 0n],
      [42_000n, 5_124_000n, 42_000n],
    ]);
    // Another invoice credits the re-issued cycle: its void is the accountant's.
    await receive(
      company,
      creditInvoice(46, '2026-12-07', 10_000, -5_000, '2026-11-15'),
      '2026-12-07',
    );
    const held = await receive(company, voidOf(81, '2026-12-07'), '2026-12-07');
    expect(held.event).toMatchObject({
      state: 'held',
      reason: 'NEEDS_DECISION',
      detail: 'schedule_credited',
    });
    expect(await proof(company)).toEqual([]);
  });

  it('frees a credit held after a later credit once Hub voids that credit (owner, 2026-11-11)', async () => {
    const company = await newCompany([
      ['2026-11-15', '121.0000'],
      ['2026-11-19', '121.0000'],
      ['2026-12-03', '123.0000'],
    ]);
    await receive(
      company,
      cycle(40, '2026-11-15', 90_000, '2026-11-15', '2026-12-14'),
      '2026-11-15',
    );
    await runJob(company, '2026-11', '2026-12-01');
    await receive(
      company,
      creditInvoice(47, '2026-12-03', 10_000, -3_000, '2026-11-15'),
      '2026-12-03',
    );
    const early = await receive(
      company,
      creditInvoice(46, '2026-11-19', 10_000, -5_000, '2026-11-15'),
      '2026-12-03',
    );
    expect(early.event).toMatchObject({
      state: 'held',
      reason: 'NEEDS_DECISION',
      detail: 'credit_after_later_change',
    });
    expect((await receive(company, voidOf(47, '2026-12-05'), '2026-12-05')).event.state).toBe(
      'posted',
    );
    const retried = await inCompany(company, (tx) =>
      retryEvent(tx, early.event.inboxId, { actor: person(), today: '2026-12-05' }),
    );
    expect(retried.event.state).toBe('posted');
    // As of 19 Nov all of it goes to the liability, and November is recut to 453.33.
    const entries = await ledger(company);
    expect(entries.at(-1)).toEqual({
      source: 'hub_event',
      date: '2026-11-30',
      lines: [
        ['411001', 'USD', 2_667n, 322_667n, 2_667n],
        ['212001', 'USD', -2_667n, -322_667n, -2_667n],
      ],
    });
    expect(await proof(company)).toEqual([]);
  });

  it('dates a moved change by its own date: a later credit of a closed month is not held for it', async () => {
    const company = await newCompany([
      ['2026-10-29', '120.0000'],
      ['2026-11-19', '121.0000'],
      ['2026-11-25', '121.0000'],
    ]);
    // The cycle invoiced in advance, in October, so November has no period row before it closes.
    await receive(
      company,
      cycle(40, '2026-10-29', 90_000, '2026-11-15', '2026-12-14'),
      '2026-10-29',
    );
    await closePeriod(company, '2026-11');
    const moved = async (n: number, on: string) => {
      const held = await receive(
        company,
        creditInvoice(n, on, 10_000, -5_000, '2026-11-15'),
        '2026-12-02',
      );
      expect(held.event).toMatchObject({ state: 'held', reason: 'PERIOD_CLOSED' });
      const result = await inCompany(company, (tx) =>
        moveEvent(tx, held.event.inboxId, 'وصل الإشعار بعد إقفال تشرين الثاني', {
          actor: person(),
          today: '2026-12-02',
        }),
      );
      expect(result.event).toMatchObject({ state: 'posted', postedOn: '2026-12-01' });
    };
    // The credit of 19 Nov posts on 1 Dec; the one of 25 Nov is dated after it, so it posts too.
    await moved(46, '2026-11-19');
    await moved(49, '2026-11-25');
    expect(await proof(company)).toEqual([]);
  });

  it('refuses a credited movement without its credit part, and a credit part on another kind', async () => {
    const company = await newCompany([['2026-11-15', '121.0000']]);
    await receive(
      company,
      cycle(20, '2026-11-15', 90_000, '2026-11-15', '2026-12-14'),
      '2026-11-15',
    );
    const forge = (kind: 'credited' | 'released', creditMinor: bigint | null) =>
      inCompany(company, async (tx) => {
        const [schedule] = await tx.select().from(recognitionSchedules);
        await tx.insert(recognitionMovements).values({
          companyId: company,
          scheduleId: schedule?.id as string,
          kind,
          month: null,
          entryId: null,
          transactionMinor: 0n,
          bookMinor: 0n,
          parallelMinor: 0n,
          creditMinor,
        });
      });
    expect(await refusal(forge('credited', null))).toMatch(/recognition_movements/);
    expect(await refusal(forge('released', 1n))).toMatch(/recognition_movements/);
  });
});

describe('the template’s recognition slots for an existing company (S06 "Data")', () => {
  it('maps the four defaults once, and leaves a company with any of them mapped', async () => {
    const company = await newCompany([]);
    const slots = [
      'contract_liability',
      'contract_asset',
      'released_revenue',
      'cancelled_project_refund',
    ] as const;
    // As a company created before S06: its mapping without the four slots.
    const removed = await superuser.connect();
    try {
      await removed.query('begin');
      await removed.query(`select set_config('app.company_id', $1, true)`, [company]);
      await removed.query(
        'alter table posting_rule_accounts disable trigger posting_rule_accounts_refuse_delete',
      );
      await removed.query(
        `delete from posting_rule_accounts where slot in ('contract_liability', 'contract_asset', 'released_revenue', 'cancelled_project_refund')`,
      );
      await removed.query(
        'alter table posting_rule_accounts enable always trigger posting_rule_accounts_refuse_delete',
      );
      await removed.query('commit');
    } finally {
      removed.release();
    }
    expect(
      await inCompany(company, (tx) => mapAppendedTemplateSlots(tx, company, slots, system)),
    ).toBe(4);
    expect(
      await inCompany(company, (tx) => mapAppendedTemplateSlots(tx, company, slots, system)),
    ).toBe(0);
    const mapped = await inCompany(company, (tx) =>
      tx
        .select({ slot: postingRuleAccounts.slot, code: chartAccounts.code })
        .from(postingRuleAccounts)
        .innerJoin(chartAccounts, eq(chartAccounts.id, postingRuleAccounts.accountId))
        .where(
          sql`${postingRuleAccounts.slot}::text in ('contract_liability', 'contract_asset', 'released_revenue', 'cancelled_project_refund')`,
        )
        .orderBy(asc(chartAccounts.code)),
    );
    expect(mapped).toEqual([
      { slot: 'contract_asset', code: '113001' },
      { slot: 'cancelled_project_refund', code: '211005' },
      { slot: 'contract_liability', code: '212001' },
      { slot: 'released_revenue', code: '411001' },
    ]);
  });

  it("maps the refund to S06's 211003 in a chart made before the templates' version 3", async () => {
    const company = await newCompany([]);
    // As a company created before S06, on the templates' version 1: no 211005, no recognition slot.
    const removed = await superuser.connect();
    try {
      await removed.query('begin');
      await removed.query(`select set_config('app.company_id', $1, true)`, [company]);
      await removed.query(
        'alter table posting_rule_accounts disable trigger posting_rule_accounts_refuse_delete',
      );
      await removed.query(
        `delete from posting_rule_accounts where slot in ('contract_liability', 'contract_asset', 'released_revenue', 'cancelled_project_refund')`,
      );
      await removed.query(
        'alter table posting_rule_accounts enable always trigger posting_rule_accounts_refuse_delete',
      );
      await removed.query(
        `update chart_accounts set archived_at = now(), archived_reason = 'version 1' where code = '211005'`,
      );
      await removed.query('commit');
    } finally {
      removed.release();
    }
    expect(
      await inCompany(company, (tx) =>
        mapAppendedTemplateSlots(
          tx,
          company,
          ['contract_liability', 'contract_asset', 'released_revenue', 'cancelled_project_refund'],
          system,
        ),
      ),
    ).toBe(4);
    const refund = await inCompany(company, (tx) =>
      tx
        .select({ code: chartAccounts.code })
        .from(postingRuleAccounts)
        .innerJoin(chartAccounts, eq(chartAccounts.id, postingRuleAccounts.accountId))
        .where(eq(postingRuleAccounts.slot, 'cancelled_project_refund')),
    );
    expect(refund).toEqual([{ code: '211003' }]);
  });
});

// A project, its milestones and a deposit invoice (`revenue/milestones`, `revenue/cancelled-project`).
const P1 = {
  external_id: ids(9005),
  code: 'P1',
  name: 'مشروع تجريبي',
  kind: 'project',
  client_external_id: C1.external_id,
};
const MS = (n: number) => ({ id: ids(500 + n), number: `MS-${n}` });
const deposit = (n: number, on: string, amount: number, milestone: number) =>
  envelope('invoice.issued', on, {
    invoice: invoiceRef(n),
    client: C1,
    contract: P1,
    currency: 'USD',
    syp_per_usd: '122.0000',
    issued_on: on,
    due_on: '2026-12-31',
    lines: [
      {
        id: ids(200 + n),
        amount,
        service: S1,
        source: 'deposit',
        milestone_id: MS(milestone).id,
      },
    ],
  });

describe('milestones and projects (S06 rules 11–17)', () => {
  const done = (milestone: number, on: string, amount: number) =>
    envelope('milestone.done', on, {
      milestone: MS(milestone),
      client: C1,
      project: P1,
      currency: 'USD',
      amount,
      done_on: on,
      service: S1,
    });
  const reopened = (milestone: number, on: string) =>
    envelope('milestone.reopened', on, {
      milestone: MS(milestone),
      client: C1,
      project: P1,
      reopened_on: on,
    });
  const kinds = (companyId: string) =>
    inCompany(companyId, async (tx) =>
      (
        await tx
          .select({ kind: recognitionMovements.kind, t: recognitionMovements.transactionMinor })
          .from(recognitionMovements)
          .orderBy(asc(recognitionMovements.createdAt), asc(recognitionMovements.id))
      ).map((row) => [row.kind, row.t]),
    );

  it('ends each month as Hub’s order on time does, whatever the order and the lateness of its events (a property)', async () => {
    // A retainer cycle, a credit to it and the credit's void; a deposit, its done and its reopen.
    // A credit before its cycle, a void before its invoice and a reopen before its done hold and
    // are retried when what they wait for posts (S06 rules 17, 19), and a credit or a void posted
    // after a month it would have cut recuts that month as of its date (owner, 2026-11-11), so any
    // order of arrival, all of it late, ends each month with what Hub's order on time does. A done that arrives before its invoice is a done not invoiced (rule 11):
    // nothing in either event tells the books Hub's order, so the deposit's invoice arrives first.
    const bulletins: [string, string][] = [
      ['2026-11-03', '120.0000'],
      ['2026-11-15', '121.0000'],
      ['2026-11-19', '121.5000'],
      ['2026-11-20', '122.0000'],
      ['2026-11-25', '122.0000'],
      ['2026-12-03', '123.0000'],
    ];
    const events = [
      deposit(91, '2026-11-03', 30_000, 7),
      cycle(92, '2026-11-15', 90_000, '2026-11-15', '2026-12-14'),
      creditInvoice(93, '2026-11-19', 10_000, -5_000, '2026-11-15'),
      done(7, '2026-11-20', 30_000),
      reopened(7, '2026-11-25'),
      voidOf(93, '2026-12-03'),
    ];
    const [invoiceAt, doneAt] = [0, 3];
    /** Each account's figures per month, in every ledger: what a report of each month reads. */
    const months = async (company: string) => {
      const sums = new Map<string, [bigint, bigint, bigint]>();
      for (const entry of await ledger(company)) {
        for (const [code, currency, amount, book, parallel] of entry.lines) {
          const key = `${code}|${currency}|${entry.date.slice(0, 7)}`;
          const [a, b, c] = sums.get(key) ?? [0n, 0n, 0n];
          sums.set(key, [
            a + (amount as bigint),
            b + (book as bigint),
            c + ((parallel as bigint | null) ?? 0n),
          ]);
        }
      }
      return [...sums.entries()]
        .filter(([, [a, b, c]]) => a !== 0n || b !== 0n || c !== 0n)
        .map(([key, [a, b, c]]) => `${key}|${a}|${b}|${c}`)
        .sort();
    };
    const outcome = async (company: string) => {
      const states = await inCompany(company, (tx) =>
        tx
          .select({
            state: inboundEventStates.state,
            reason: inboundEventStates.holdReason,
            detail: inboundEventStates.holdDetail,
          })
          .from(inboundEventStates),
      );
      return {
        states: states.map((row) => [row.state, row.reason, row.detail].join(':')).sort(),
        months: await months(company),
        problems: await proof(company),
      };
    };
    // Hub's order, each event received on its own date and each month's job on the next month's
    // first day.
    const onTime = await newCompany(bulletins);
    for (const event of events) {
      if (event.accounting_date >= '2026-12-01') await runJob(onTime, '2026-11', '2026-12-01');
      await receive(onTime, event, event.accounting_date);
    }
    await runJob(onTime, '2026-12', '2027-01-01');
    const hubOrder = await outcome(onTime);
    expect(hubOrder.states.every((state) => state === 'posted::')).toBe(true);
    expect(hubOrder.problems).toEqual([]);
    await fc.assert(
      fc.asyncProperty(
        fc
          .shuffledSubarray([0, 1, 2, 3, 4, 5], { minLength: 6, maxLength: 6 })
          .filter((order) => order.indexOf(invoiceAt) < order.indexOf(doneAt)),
        async (order) => {
          // Every event late, received after both months ended (owner, 2026-11-11).
          const late = await newCompany(bulletins);
          for (const index of order) {
            await receive(late, events[index] as EventEnvelope, '2027-01-05');
          }
          await runJob(late, '2026-11', '2027-01-05');
          await runJob(late, '2026-12', '2027-01-05');
          expect(await outcome(late)).toEqual(hubOrder);
        },
      ),
      { numRuns: 12 },
    );
  }, 120_000);

  it('releases a deposit at its done, gives it back on a reopen and releases it again; a replay posts nothing', async () => {
    const companyId = await newCompany([['2026-11-03', '120.0000']]);
    const issued = deposit(60, '2026-11-03', 30_000, 1);
    expect((await receive(companyId, issued, '2026-11-03')).event.state).toBe('posted');
    const keys = await inCompany(companyId, (tx) =>
      tx
        .select({ itemKey: inboundEvents.itemKey, orderKeys: inboundEvents.orderKeys })
        .from(inboundEvents),
    );
    expect(keys).toEqual([
      {
        itemKey: `invoice:${invoiceRef(60).id}`,
        orderKeys: [`milestone:${MS(1).id}`, `project:${P1.external_id}`],
      },
    ]);
    const first = done(1, '2026-11-20', 30_000);
    expect((await receive(companyId, first, '2026-11-20')).event.state).toBe('posted');
    expect((await receive(companyId, first, '2026-11-20')).replayed).toBe(true);
    expect(await remaining(companyId)).toEqual([[0n, 0n, 0n]]);
    expect((await receive(companyId, reopened(1, '2026-12-03'), '2026-12-03')).event.state).toBe(
      'posted',
    );
    // The reopen gives the schedule what the done released.
    expect(await remaining(companyId)).toEqual([[30_000n, 3_600_000n, 30_000n]]);
    expect(
      (await receive(companyId, done(1, '2026-12-10', 30_000), '2026-12-10')).event.state,
    ).toBe('posted');
    expect(await kinds(companyId)).toEqual([
      ['deferred', 30_000n],
      ['released', -30_000n],
      ['released', 30_000n],
      ['released', -30_000n],
    ]);
    const entries = await ledger(companyId);
    expect(entries.map((entry) => [entry.source, entry.date])).toEqual([
      ['hub_event', '2026-11-03'],
      ['hub_event', '2026-11-20'],
      ['hub_event', '2026-12-03'],
      ['hub_event', '2026-12-10'],
    ]);
    // Each release at the 36,000.00 SYP the liability carries; the reopen its exact reversal.
    expect(entries[1]?.lines).toEqual([
      ['212001', 'USD', 30_000n, 3_600_000n, 30_000n],
      ['411001', 'USD', -30_000n, -3_600_000n, -30_000n],
    ]);
    expect(entries[2]?.lines).toEqual([
      ['212001', 'USD', -30_000n, -3_600_000n, -30_000n],
      ['411001', 'USD', 30_000n, 3_600_000n, 30_000n],
    ]);
    expect(entries[3]?.lines).toEqual(entries[1]?.lines);
  });

  it('holds a completion for the accountant once a done of its milestone was resolved by hand (S05 rule 16)', async () => {
    const companyId = await newCompany([
      ['2026-11-03', '120.0000'],
      ['2026-11-25', '121.0000'],
    ]);
    await receive(companyId, deposit(70, '2026-11-03', 30_000, 1), '2026-11-03');
    const withoutService = envelope('milestone.done', '2026-11-20', {
      milestone: MS(1),
      client: C1,
      project: P1,
      currency: 'USD',
      amount: 30_000,
      done_on: '2026-11-20',
    });
    const held = await receive(companyId, withoutService, '2026-11-20');
    expect(held.event).toMatchObject({
      reason: 'NEEDS_DECISION',
      detail: 'milestone_service_missing',
    });
    const completed = envelope('project.completed', '2026-11-25', {
      project: P1,
      client: C1,
      on: '2026-11-25',
    });
    // In the project's order, behind the held done (S06 rule 17).
    expect((await receive(companyId, completed, '2026-11-25')).event.reason).toBe(
      'WAITING_FOR_EARLIER_EVENT',
    );
    // The accountant releases the deposit by hand and resolves the done with that entry.
    const resolved = await inCompany(companyId, async (tx) => {
      const [schedule] = await tx.select().from(recognitionSchedules);
      if (!schedule?.contractValueId) throw new Error('No schedule');
      const account = async (code: string) => {
        const [row] = await tx
          .select({ id: chartAccounts.id })
          .from(chartAccounts)
          .where(eq(chartAccounts.code, code));
        return row?.id as string;
      };
      const parties = [schedule.clientValueId, schedule.contractValueId];
      const entry = await post(tx, {
        client: 'manual',
        idempotencyKey: uuidv7(),
        entryDate: '2026-11-25',
        description: 'تحرير الدفعة يدويًا',
        reference: null,
        draftId: null,
        preparedByUserId: personId,
        approvedByUserId: null,
        actor: person(),
        content: {
          kind: 'manual',
          dealtRates: [],
          today: '2026-11-25',
          lines: [
            {
              accountId: await account('212001'),
              dimensionValueIds: parties,
              currency: 'USD',
              amountMinor: 30_000n,
              memo: null,
            },
            {
              accountId: await account('411001'),
              dimensionValueIds: [...parties, schedule.serviceValueId],
              currency: 'USD',
              amountMinor: -30_000n,
              memo: null,
            },
          ],
        },
      });
      return resolveEvent(tx, held.event.inboxId, entry.id, 'أُنجزت المرحلة', {
        actor: person(),
        today: '2026-11-25',
      });
    });
    await inCompany(companyId, (tx) =>
      retryFreed(tx, resolved.triggers, { actor: system, today: '2026-11-25' }),
    );
    // The completion does not release the deposit a second time.
    const states = await inCompany(companyId, (tx) =>
      tx
        .select({ type: inboundEvents.type, detail: inboundEventStates.holdDetail })
        .from(inboundEvents)
        .innerJoin(inboundEventStates, eq(inboundEventStates.eventId, inboundEvents.id))
        .where(eq(inboundEvents.type, 'project.completed')),
    );
    expect(states).toEqual([{ type: 'project.completed', detail: 'document_resolved_manually' }]);
    expect((await ledger(companyId)).map((entry) => entry.source)).toEqual(['hub_event', 'manual']);
  });

  it('splits a held cancellation once when two splits arrive at once; its void waits behind it, then is held', async () => {
    const companyId = await newCompany([
      ['2026-11-03', '120.0000'],
      ['2026-12-10', '124.0000'],
    ]);
    await receive(companyId, deposit(80, '2026-11-03', 30_000, 1), '2026-11-03');
    const cancelled = envelope('project.cancelled', '2026-12-10', {
      project: P1,
      client: C1,
      on: '2026-12-10',
    });
    const held = await receive(companyId, cancelled, '2026-12-10');
    expect(held.event).toMatchObject({
      state: 'held',
      reason: 'NEEDS_DECISION',
      detail: 'cancelled_project_remainder',
    });
    const voided = envelope('invoice.voided', '2026-12-14', {
      invoice: invoiceRef(80),
      voided_on: '2026-12-14',
      reason: 'ملغاة في Hub',
    });
    // In its project's order, behind the cancellation (S06 rule 17).
    expect((await receive(companyId, voided, '2026-12-14')).event).toMatchObject({
      state: 'held',
      reason: 'WAITING_FOR_EARLIER_EVENT',
      waitingForInboxId: held.event.inboxId,
    });
    const split = () =>
      inCompany(companyId, (tx) =>
        splitEvent(tx, held.event.inboxId, 10_000n, 'ثلث الدفعة مستحق', {
          actor: person(),
          today: '2026-12-14',
        }),
      ).then(
        (result) => result,
        (error: unknown) => {
          if (error instanceof DomainError) return error.code;
          throw error;
        },
      );
    const answers = await Promise.all([split(), split()]);
    const results = answers.filter((answer) => typeof answer !== 'string');
    expect(answers.filter((answer) => typeof answer === 'string')).toEqual(['EVENT_NOT_HELD']);
    expect(results.map((result) => result.event.state)).toEqual(['posted']);
    expect(await remaining(companyId)).toEqual([[0n, 0n, 0n]]);
    expect(await kinds(companyId)).toEqual([
      ['deferred', 30_000n],
      ['remainder_released', -10_000n],
      ['remainder_refunded', -20_000n],
    ]);
    const [, entry] = await ledger(companyId);
    expect(entry?.lines).toEqual([
      ['212001', 'USD', 30_000n, 3_600_000n, 30_000n],
      ['411001', 'USD', -10_000n, -1_200_000n, -10_000n],
      ['211005', 'USD', -20_000n, -2_480_000n, -20_000n],
      ['541001', 'SYP', 80_000n, 80_000n, 0n],
    ]);
    // The split frees the project's order: the void, retried, is the accountant's.
    await inCompany(companyId, (tx) =>
      retryFreed(tx, results[0]?.triggers ?? [], { actor: system, today: '2026-12-14' }),
    );
    const actions = await inCompany(companyId, (tx) =>
      tx
        .select({ action: inboundEventActions.action, detail: inboundEventActions.holdDetail })
        .from(inboundEventActions)
        .orderBy(asc(inboundEventActions.createdAt), asc(inboundEventActions.id)),
    );
    expect(actions.at(-1)).toEqual({
      action: 'attempted',
      detail: 'schedule_split_at_cancellation',
    });
    expect(actions.filter((row) => row.action === 'remainder_split')).toHaveLength(1);
  });
});

describe('the previews of the accountant’s actions (S06 "Screens", rule 16)', () => {
  /** Every row an action could write: entries, lines, states, actions and audit rows. */
  const written = (companyId: string) =>
    inCompany(companyId, async (tx) => {
      const { rows } = await tx.execute<Record<string, string>>(sql`select
        (select count(*) from journal_entries) as entries,
        (select count(*) from journal_lines) as lines,
        (select count(*) from inbound_event_actions) as actions,
        (select count(*) from audit_entries) as audits,
        (select count(*) from recognition_movements) as movements,
        (select string_agg(state || ':' || coalesce(hold_reason, ''), ',' order by id)
          from inbound_event_states) as states`);
      return rows[0];
    });
  const linesOf = (preview: Awaited<ReturnType<typeof previewAction>>) =>
    preview.entries.map((entry) => ({
      date: entry.date,
      lines: entry.lines.map((line) => [
        line.accountCode,
        line.currency,
        line.amountMinor,
        line.bookMinor,
        line.parallelMinor,
      ]),
    }));

  it('previews the recognition in the first open period as it then posts, writing nothing', async () => {
    const company = await newCompany([
      ['2026-10-29', '119.0000'],
      ['2026-11-05', '120.5000'],
    ]);
    await closePeriod(company, '2026-10');
    const invoice = await receive(
      company,
      cycle(25, '2026-11-05', 62_000, '2026-10-20', '2026-11-19'),
      '2026-11-05',
    );
    expect(invoice.event).toMatchObject({ reason: 'SERVICE_PERIOD_CLOSED' });
    const before = await written(company);
    const options = { actor: person(), today: '2026-11-05' };
    const preview = await inCompany(company, (tx) =>
      previewAction(tx, invoice.event.inboxId, { kind: 'recognise' }, options),
    );
    expect(await written(company)).toEqual(before);
    expect(preview).toMatchObject({ state: 'posted', reason: null, detail: null });
    // October's part on 1 November, measured at 31 October.
    expect(
      preview.entries.map((entry) => [entry.date, entry.source, entry.servicePeriodOn]),
    ).toEqual([
      ['2026-11-01', 'hub_event', '2026-10-31'],
      ['2026-11-05', 'hub_event', null],
    ]);
    await expect(
      inCompany(company, (tx) =>
        previewAction(tx, invoice.event.inboxId, { kind: 'split', revenueMinor: 0n }, options),
      ),
    ).rejects.toMatchObject({ code: 'EVENT_ACTION_NOT_ALLOWED' });
    await inCompany(company, (tx) =>
      recogniseEvent(tx, invoice.event.inboxId, 'وصلت الفاتورة بعد الإقفال', options),
    );
    expect((await ledger(company)).map(({ date, lines }) => ({ date, lines }))).toEqual(
      linesOf(preview),
    );
    await expect(
      inCompany(company, (tx) =>
        previewAction(tx, invoice.event.inboxId, { kind: 'recognise' }, options),
      ),
    ).rejects.toMatchObject({ code: 'EVENT_NOT_HELD' });
  });

  it('previews a cancelled project’s split as it then posts, and refuses one outside the remainder', async () => {
    const company = await newCompany([
      ['2026-11-03', '120.0000'],
      ['2026-12-10', '124.0000'],
    ]);
    await receive(company, deposit(81, '2026-11-03', 30_000, 1), '2026-11-03');
    const held = await receive(
      company,
      envelope('project.cancelled', '2026-12-10', { project: P1, client: C1, on: '2026-12-10' }),
      '2026-12-10',
    );
    expect(held.event).toMatchObject({ detail: 'cancelled_project_remainder' });
    const options = { actor: person(), today: '2026-12-14' };
    const before = await written(company);
    const preview = (revenueMinor: bigint) =>
      inCompany(company, (tx) =>
        previewAction(tx, held.event.inboxId, { kind: 'split', revenueMinor }, options),
      );
    const all = await preview(0n);
    expect(linesOf(all)).toEqual([
      {
        date: '2026-12-10',
        lines: [
          ['212001', 'USD', 30_000n, 3_600_000n, 30_000n],
          ['211005', 'USD', -30_000n, -3_720_000n, -30_000n],
          ['541001', 'SYP', 120_000n, 120_000n, 0n],
        ],
      },
    ]);
    await expect(preview(30_001n)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { remainingMinor: '30000' },
    });
    const part = await preview(10_000n);
    expect(await written(company)).toEqual(before);
    await expect(
      inCompany(company, (tx) =>
        previewAction(tx, held.event.inboxId, { kind: 'recognise' }, options),
      ),
    ).rejects.toMatchObject({ code: 'EVENT_ACTION_NOT_ALLOWED' });
    await inCompany(company, (tx) =>
      splitEvent(tx, held.event.inboxId, 10_000n, 'ثلث الدفعة مستحق', options),
    );
    const [, entry] = await ledger(company);
    expect(linesOf(part)).toEqual([{ date: entry?.date, lines: entry?.lines }]);
  });
});

describe('the guards of the recognition tables (0032)', () => {
  it('check the movement kinds the API answers', () => {
    expect([...RECOGNITION_MOVEMENT_KINDS]).toEqual([...REVENUE_MOVEMENT_KINDS]);
  });

  it('keep schedules and movements append-only for the app role and the owner', async () => {
    const company = await newCompany([['2026-11-15', '121.0000']]);
    await receive(
      company,
      cycle(20, '2026-11-15', 90_000, '2026-11-15', '2026-12-14'),
      '2026-11-15',
    );
    for (const db of [app, owner]) {
      expect(
        await refusal(
          withCompany(db, company, (tx) =>
            tx.execute(sql`update recognition_movements set transaction_minor = 1`),
          ),
        ),
      ).toMatch(/./);
      expect(
        await refusal(
          withCompany(db, company, (tx) => tx.execute(sql`delete from recognition_schedules`)),
        ),
      ).toMatch(/./);
    }
  });

  it('refuse a movement of an entry posted in another transaction, and a remaining below zero', async () => {
    const company = await newCompany([['2026-11-15', '121.0000']]);
    await receive(
      company,
      cycle(20, '2026-11-15', 90_000, '2026-11-15', '2026-12-14'),
      '2026-11-15',
    );
    const forge = (fields: {
      transactionMinor: bigint;
      bookMinor: bigint;
      parallelMinor: bigint;
    }) =>
      inCompany(company, async (tx) => {
        const [schedule] = await tx.select().from(recognitionSchedules);
        const [entry] = await tx.select().from(journalEntries);
        await tx.insert(recognitionMovements).values({
          companyId: company,
          scheduleId: schedule?.id as string,
          kind: 'released',
          month: '2026-11-01',
          entryId: entry?.id as string,
          ...fields,
        });
      });
    // The issue entry was posted by an earlier transaction.
    expect(
      await refusal(forge({ transactionMinor: -1n, bookMinor: -121n, parallelMinor: -1n })),
    ).toMatch(/./);
    // An entry of the same transaction, as a release posts it, but a movement taking more than
    // the schedule holds: refused at commit.
    const overdrawn = await refusal(
      inCompany(company, async (tx) => {
        const [schedule] = await tx.select().from(recognitionSchedules);
        if (!schedule) throw new Error('No schedule');
        const [revenue] = await tx
          .select({ id: chartAccounts.id })
          .from(chartAccounts)
          .where(eq(chartAccounts.code, '411001'));
        const parties = [schedule.clientValueId, schedule.contractValueId as string];
        const amounts = {
          transaction: money(90_001n, 'USD'),
          bookMinor: 1n,
          parallelMinor: 90_001n,
        };
        const entry = await post(tx, {
          client: 'system',
          idempotencyKey: `forged:${uuidv7()}`,
          entryDate: '2026-11-30',
          description: 'قيد مزوّر',
          reference: null,
          draftId: null,
          preparedByUserId: null,
          approvedByUserId: null,
          actor: system,
          content: {
            kind: 'carried',
            source: 'revenue_release',
            lines: [
              { accountId: schedule.liabilityAccountId, dimensionValueIds: parties, amounts },
              {
                accountId: revenue?.id as string,
                dimensionValueIds: [...parties, schedule.serviceValueId],
                amounts: negate(amounts),
              },
            ],
            today: '2026-12-01',
            hub: {
              inboxId: schedule.eventId as string,
              clientId: CLIENT_ID,
              document: {
                type: 'invoice',
                id: schedule.invoiceDocumentId,
                number: schedule.invoiceNumber,
              },
            },
          },
        });
        await tx.insert(recognitionMovements).values({
          companyId: company,
          scheduleId: schedule.id,
          kind: 'released',
          month: '2026-11-01',
          entryId: entry.id,
          transactionMinor: -90_001n,
          bookMinor: -1n,
          parallelMinor: -90_001n,
        });
      }),
    );
    expect(overdrawn).toMatch(/./);
  });
});
