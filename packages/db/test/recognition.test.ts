import {
  type CompanyLedgers,
  type EventEnvelope,
  money,
  parseEventEnvelope,
} from '@vertex-mizan/contracts';
import { negate } from '@vertex-mizan/ledger';
import { and, asc, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type AuditActor,
  chartAccounts,
  createCompanyBooks,
  inboundEventActions,
  journalEntries,
  journalLines,
  mapAppendedTemplateSlots,
  moveEvent,
  openItemBalances,
  openItems,
  type PersonActor,
  post,
  postingRuleAccounts,
  receiveEvent,
  recogniseEvent,
  recognitionMovements,
  recognitionSchedules,
  recordRate,
  releaseMonth,
  retryFreed,
  type Transaction,
  users,
  withCompany,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

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
  // S07 brings the close; here the superuser closes the month, as the inbox tests do.
  const closer = await superuser.connect();
  try {
    await closer.query('begin');
    await closer.query('alter table periods disable trigger period_rules');
    await closer.query(
      `insert into periods (id, company_id, period, fiscal_year, state) values ($1, $2, $3, 2026, 'closed')`,
      [uuidv7(), companyId, period],
    );
    await closer.query('alter table periods enable always trigger period_rules');
    await closer.query('commit');
  } finally {
    closer.release();
  }
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

  it('holds the void of a deferred invoice until S06’s void rule deploys', async () => {
    const company = await newCompany([['2026-11-15', '121.0000']]);
    await receive(
      company,
      cycle(20, '2026-11-15', 90_000, '2026-11-15', '2026-12-14'),
      '2026-11-15',
    );
    const voided = await receive(
      company,
      envelope('invoice.voided', '2026-11-20', {
        invoice: invoiceRef(20),
        voided_on: '2026-11-20',
        reason: 'خطأ',
      }),
      '2026-11-20',
    );
    expect(voided.event).toMatchObject({
      state: 'held',
      reason: 'NO_MAPPING',
      detail: 'deferred_revenue',
    });
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
      { slot: 'cancelled_project_refund', code: '211003' },
      { slot: 'contract_liability', code: '212001' },
      { slot: 'released_revenue', code: '411001' },
    ]);
  });
});

describe('the guards of the recognition tables (0032)', () => {
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
              inboxId: schedule.eventId,
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
