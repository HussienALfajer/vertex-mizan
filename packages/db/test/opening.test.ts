import {
  type CompanyLedgers,
  DomainError,
  OPENING_STATES,
  openingSnapshotSchema,
  REVENUE_MOVEMENT_KINDS,
  saveOpeningSchema,
} from '@vertex-mizan/contracts';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type AuditActor,
  apiClients,
  chartAccounts,
  closePeriod,
  companySettings,
  createCompanyBooks,
  dimensionTypes,
  dimensionValues,
  journalEntries,
  journalLines,
  OPENING_ROW_STATES,
  openingLines,
  openingSnapshots,
  openings,
  type PersonActor,
  post,
  postOpening,
  RECOGNITION_MOVEMENT_KINDS,
  readOpening,
  receiveEvent,
  receiveOpeningSnapshot,
  recognitionMovements,
  recognitionSchedules,
  recordRate,
  reverseOpening,
  saveOpening,
  type Transaction,
  users,
  withCompany,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// S10's opening in the database (rules 2–25): the books start's lock, Hub's snapshot kept once per
// key and as of the eve, the draft's versions, the checks, the posting through `post()` with its
// schedules, the whole reversal while the opening is the only entry, nothing posted or closed
// before the opening, and the guards against forged rows. The scenario book holds the numbers
// (`opening/opening-entry.md`).

const { app, owner } = connect();

let personId = '';

const person = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'مالك تجريبي',
  sessionId: null,
  requestId: 'request-opening-test',
  ipAddress: null,
  userAgent: null,
});

const hubActor = (clientId: string): AuditActor => ({
  kind: 'api_client',
  clientId,
  name: 'Vertex Hub',
  requestId: 'request-opening-test',
  ipAddress: null,
  userAgent: null,
});

const SYP_USD: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

const ids = (n: number) => `01934b6e-0000-7000-8000-${String(n).padStart(12, '0')}`;
const C1 = { external_id: ids(9101), code: 'C1', name: 'عميل تجريبي' };
const R1 = {
  external_id: ids(9102),
  code: 'R1',
  name: 'عقد تجريبي',
  kind: 'retainer' as const,
  client_external_id: ids(9101),
};
const S1 = { external_id: ids(9103), code: 'S1', name: 'خدمة تجريبية' };

const inCompany = <T>(companyId: string, work: (tx: Transaction) => Promise<T>) =>
  withCompany(app, companyId, work);

/** A company with the service-agency chart, its books starting on 1 October 2026. */
async function newCompany(booksStart: string | null = '2026-10-01') {
  const companyId = uuidv7();
  await withCompany(app, companyId, (tx) =>
    createCompanyBooks(
      tx,
      companyId,
      {
        name: 'شركة افتتاح تجريبية',
        nameLatin: null,
        ledgers: SYP_USD,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'service-agency',
        createdByUserId: personId,
        booksStart,
      },
      person(),
    ),
  );
  return companyId;
}

async function newHubClient(companyId: string) {
  const [row] = await app
    .insert(apiClients)
    .values({
      scopeCompanyId: companyId,
      name: 'Vertex Hub',
      system: 'hub',
      scopes: ['opening:write'],
      createdByUserId: personId,
    })
    .returning({ id: apiClients.id });
  return row?.id as string;
}

const snapshot = (asOf = '2026-09-30') =>
  openingSnapshotSchema.parse({
    as_of: asOf,
    generated_at: '2026-10-25T08:00:00+03:00',
    invoices: [
      {
        invoice: { id: ids(1), number: 'INV-1' },
        client: C1,
        contract: R1,
        currency: 'USD',
        syp_per_usd: '117.0000',
        issued_on: '2026-09-10',
        due_on: '2026-09-25',
        total: 30_000,
        outstanding: 30_000,
        lines: [
          {
            id: ids(2),
            amount: 30_000,
            service: S1,
            source: 'retainer_charge',
            charge_kind: 'monthly',
            cycle_start: '2026-09-16',
            cycle_end: '2026-10-15',
          },
        ],
      },
    ],
  });

async function recordRates(companyId: string) {
  await inCompany(companyId, async (tx) => {
    for (const [on, type, rate] of [
      ['2026-09-10', 'bulletin', '114.0000'],
      ['2026-09-30', 'bulletin', '115.0000'],
      ['2026-09-30', 'market', '118.0000'],
    ] as const) {
      await recordRate(tx, companyId, person(), {
        effectiveOn: on,
        base: 'USD',
        quote: 'SYP',
        rate,
        type,
        source: 'manual',
      });
    }
  });
}

async function accountId(tx: Transaction, code: string) {
  const [row] = await tx.select().from(chartAccounts).where(eq(chartAccounts.code, code));
  return row?.id as string;
}

async function clientValueId(tx: Transaction) {
  const [row] = await tx
    .select({ id: dimensionValues.id })
    .from(dimensionValues)
    .innerJoin(dimensionTypes, eq(dimensionTypes.id, dimensionValues.typeId))
    .where(eq(dimensionTypes.code, 'client'));
  return row?.id as string;
}

/** The records of the worked example: SYP cash, capital and the result before the books start. */
async function save(tx: Transaction, version: number, withFigure = true) {
  return saveOpening(
    tx,
    saveOpeningSchema.parse({
      version,
      lines: [
        { accountId: await accountId(tx, '111001'), currency: 'SYP', amount: '200000000' },
        {
          accountId: await accountId(tx, '311001'),
          currency: 'SYP',
          amount: '-100000000',
          parallel: '-1000000',
        },
      ],
      recordFigures: withFigure
        ? [
            {
              slot: 'receivable',
              clientValueId: await clientValueId(tx),
              currency: 'USD',
              amount: '30000',
            },
          ]
        : [],
    }),
    person(),
  );
}

/** A company with its snapshot received, its rates recorded and its draft saved, ready to post. */
async function readyCompany() {
  const companyId = await newCompany();
  const clientId = await newHubClient(companyId);
  await inCompany(companyId, (tx) =>
    receiveOpeningSnapshot(tx, {
      companyId,
      apiClientId: clientId,
      snapshotKey: 'snapshot-1',
      snapshot: snapshot(),
      actor: hubActor(clientId),
    }),
  );
  await recordRates(companyId);
  await inCompany(companyId, (tx) => save(tx, 0));
  return { companyId, clientId };
}

const manualEntry = async (tx: Transaction, on = '2026-10-05') =>
  post(tx, {
    client: 'manual',
    idempotencyKey: uuidv7(),
    entryDate: on,
    description: 'إيجار تجريبي',
    reference: null,
    draftId: null,
    preparedByUserId: personId,
    approvedByUserId: null,
    actor: person(),
    content: {
      kind: 'manual',
      today: on,
      dealtRates: [],
      lines: [
        {
          accountId: await accountId(tx, '531001'),
          dimensionValueIds: [],
          currency: 'SYP',
          amountMinor: 100n,
          memo: null,
        },
        {
          accountId: await accountId(tx, '111001'),
          dimensionValueIds: [],
          currency: 'SYP',
          amountMinor: -100n,
          memo: null,
        },
      ],
    },
  });

const codeOf = async (work: Promise<unknown>) => {
  try {
    await work;
    return 'none';
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
};

beforeAll(async () => {
  const [user] = await app
    .insert(users)
    .values({ email: `opening-${uuidv7()}@example.test`, name: 'مالك تجريبي' })
    .returning({ id: users.id });
  personId = user?.id as string;
});

describe('the opening (S10)', () => {
  it('keeps its lists equal to the contracts', () => {
    expect([...OPENING_ROW_STATES]).toEqual([...OPENING_STATES]);
    expect([...RECOGNITION_MOVEMENT_KINDS]).toEqual([...REVENUE_MOVEMENT_KINDS]);
  });

  it('refuses everything but the opening before it is posted (rule 3)', async () => {
    const companyId = await newCompany();
    expect(await codeOf(inCompany(companyId, (tx) => manualEntry(tx)))).toBe('OPENING_NOT_POSTED');
    const clientId = await newHubClient(companyId);
    const envelope = {
      id: uuidv7(),
      type: 'rate.changed',
      version: 1,
      occurred_at: '2026-10-05T12:00:00+03:00',
      accounting_date: '2026-10-05',
      payload: { effective_on: '2026-10-05', syp_per_usd: '118.0000' },
    };
    expect(
      await inCompany(companyId, (tx) =>
        codeOf(
          receiveEvent(
            tx,
            companyId,
            {
              raw: envelope,
              envelope: envelope as never,
              apiClientId: clientId,
              requestId: 'request-opening-test',
            },
            { actor: hubActor(clientId), today: '2026-10-05' },
          ),
        ),
      ),
    ).toBe('OPENING_NOT_POSTED');
    expect(
      await inCompany(companyId, (tx) =>
        codeOf(
          closePeriod(tx, {
            period: '2026-10',
            reason: 'إقفال',
            today: '2026-11-05',
            actor: person(),
          }),
        ),
      ),
    ).toBe('OPENING_NOT_POSTED');
    // The guard refuses it again, whoever writes.
    const [count] = await inCompany(companyId, (tx) =>
      tx.select({ n: sql<number>`count(*)::int` }).from(journalEntries),
    );
    expect(count?.n).toBe(0);
  });

  it('locks the books start once a snapshot arrives, and never clears it (rule 2)', async () => {
    const companyId = await newCompany();
    await inCompany(companyId, (tx) =>
      tx.update(companySettings).set({ booksStart: '2026-11-01' }),
    );
    expect(
      await refusal(
        inCompany(companyId, (tx) => tx.update(companySettings).set({ booksStart: null })),
      ),
    ).toContain('BOOKS_START_LOCKED');
    expect(
      await refusal(
        inCompany(companyId, (tx) => tx.update(companySettings).set({ booksStart: '2026-11-15' })),
      ),
    ).toContain('company_settings_books_start');
    await inCompany(companyId, (tx) =>
      tx.update(companySettings).set({ booksStart: '2026-10-01' }),
    );
    const clientId = await newHubClient(companyId);
    await inCompany(companyId, (tx) =>
      receiveOpeningSnapshot(tx, {
        companyId,
        apiClientId: clientId,
        snapshotKey: 'snapshot-1',
        snapshot: snapshot(),
        actor: hubActor(clientId),
      }),
    );
    expect(
      await refusal(
        inCompany(companyId, (tx) => tx.update(companySettings).set({ booksStart: '2026-09-01' })),
      ),
    ).toContain('BOOKS_START_LOCKED');
  });

  it('stores a snapshot once per key, refuses another body and an eve that is not one', async () => {
    const companyId = await newCompany();
    const clientId = await newHubClient(companyId);
    const send = (key: string, body = snapshot()) =>
      inCompany(companyId, (tx) =>
        receiveOpeningSnapshot(tx, {
          companyId,
          apiClientId: clientId,
          snapshotKey: key,
          snapshot: body,
          actor: hubActor(clientId),
        }),
      );
    const first = await send('key-1');
    expect(first).toMatchObject({ replayed: false, as_of: '2026-09-30', counts: { invoices: 1 } });
    expect(await send('key-1')).toMatchObject({ snapshot_id: first.snapshot_id, replayed: true });
    expect(
      await codeOf(send('key-1', { ...snapshot(), wallets: [{ client: C1, balance: 1 }] })),
    ).toBe('IDEMPOTENCY_CONFLICT');
    expect(
      await codeOf(
        send(
          'key-2',
          openingSnapshotSchema.parse({
            as_of: '2026-08-31',
            generated_at: '2026-10-25T08:00:00+03:00',
          }),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    const without = await newCompany(null);
    expect(
      await inCompany(without, (tx) =>
        codeOf(
          receiveOpeningSnapshot(tx, {
            companyId: without,
            apiClientId: clientId,
            snapshotKey: 'key-1',
            snapshot: snapshot(),
            actor: hubActor(clientId),
          }),
        ),
      ),
    ).toBe('NO_BOOKS_START');
    // The guard holds the eve and the append-only rows for every role.
    expect(
      await refusal(
        inCompany(companyId, (tx) =>
          tx.insert(openingSnapshots).values({
            companyId,
            apiClientId: clientId,
            snapshotKey: 'forged',
            asOf: '2026-09-29',
            generatedAt: new Date(),
            payload: {},
            payloadHash: 'a'.repeat(64),
            invoiceCount: 0,
            walletCount: 0,
            milestoneCount: 0,
            priorDocumentCount: 0,
          }),
        ),
      ),
    ).toContain('eve of the books start');
    expect(
      await refusal(
        withCompany(owner, companyId, (tx) =>
          tx.update(openingSnapshots).set({ snapshotKey: 'changed' }),
        ),
      ),
    ).toContain('append-only');
  });

  it('checks before posting, and refuses a stale version or fingerprint (rules 16, 21, 23)', async () => {
    const companyId = await newCompany();
    const clientId = await newHubClient(companyId);
    // A Hub client and no snapshot yet; no rate recorded.
    await inCompany(companyId, (tx) => save(tx, 0, false));
    const empty = await inCompany(companyId, readOpening);
    expect(empty.checks.filter((check) => !check.passed).map((check) => check.check)).toEqual([
      'snapshot',
      'rates',
    ]);
    expect(await codeOf(inCompany(companyId, (tx) => save(tx, 0, false)))).toBe('OPENING_CHANGED');
    await inCompany(companyId, (tx) =>
      receiveOpeningSnapshot(tx, {
        companyId,
        apiClientId: clientId,
        snapshotKey: 'snapshot-1',
        snapshot: snapshot(),
        actor: hubActor(clientId),
      }),
    );
    await recordRates(companyId);
    const view = await inCompany(companyId, readOpening);
    expect(view.checks.filter((check) => !check.passed).map((check) => check.check)).toEqual([
      'records_agree',
    ]);
    expect(
      await inCompany(companyId, (tx) =>
        codeOf(postOpening(tx, { fingerprint: view.fingerprint, actor: person() })),
      ),
    ).toBe('OPENING_CHECKS_FAILED');
    await inCompany(companyId, (tx) => save(tx, 1));
    // The save changed the version: the earlier fingerprint is stale.
    expect(
      await inCompany(companyId, (tx) =>
        codeOf(postOpening(tx, { fingerprint: view.fingerprint, actor: person() })),
      ),
    ).toBe('OPENING_CHANGED');
    // A line on Hub's receivable slot is refused while a Hub client stands (rule 12).
    expect(
      await inCompany(companyId, async (tx) =>
        codeOf(
          saveOpening(
            tx,
            saveOpeningSchema.parse({
              version: 2,
              lines: [{ accountId: await accountId(tx, '112001'), currency: 'USD', amount: '100' }],
              recordFigures: [],
            }),
            person(),
          ),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('posts once, with its schedule, and reverses whole only while it is the only entry (rules 23, 25)', async () => {
    const { companyId } = await readyCompany();
    const view = await inCompany(companyId, readOpening);
    expect(view.checks.every((check) => check.passed)).toBe(true);
    // Two owners at once: one posts, the other is refused.
    const answers = await Promise.all(
      [0, 1].map(() =>
        inCompany(companyId, (tx) =>
          postOpening(tx, { fingerprint: view.fingerprint, actor: person() }),
        ).then(
          () => 'posted',
          (error: unknown) => (error instanceof DomainError ? error.code : 'error'),
        ),
      ),
    );
    expect(answers.sort()).toEqual(['OPENING_POSTED', 'posted']);
    const [entry] = await inCompany(companyId, (tx) => tx.select().from(journalEntries));
    expect(entry).toMatchObject({ source: 'opening', entryDate: '2026-10-01', number: 1 });
    const kinds = await inCompany(companyId, (tx) =>
      tx
        .select({ kind: recognitionMovements.kind, month: recognitionMovements.month })
        .from(recognitionMovements),
    );
    expect(kinds).toEqual([
      { kind: 'deferred', month: null },
      { kind: 'before_opening', month: '2026-09-01' },
    ]);
    expect(await codeOf(inCompany(companyId, (tx) => save(tx, 1)))).toBe('OPENING_POSTED');
    // After posting, entries post; the whole reversal is refused once another entry stands.
    const reversed = await inCompany(companyId, (tx) =>
      reverseOpening(tx, { reason: 'تصحيح تجريبي', actor: person() }),
    );
    expect(reversed.entry.number).toBe(2);
    expect(await codeOf(inCompany(companyId, (tx) => manualEntry(tx)))).toBe('OPENING_NOT_POSTED');
    const again = await inCompany(companyId, readOpening);
    expect(again.version).toBe(0);
    expect(again.recordLines).toHaveLength(2);
    await inCompany(companyId, (tx) => save(tx, 0));
    const ready = await inCompany(companyId, readOpening);
    await inCompany(companyId, (tx) =>
      postOpening(tx, { fingerprint: ready.fingerprint, actor: person() }),
    );
    await inCompany(companyId, (tx) => manualEntry(tx));
    expect(
      await inCompany(companyId, (tx) =>
        codeOf(reverseOpening(tx, { reason: 'تصحيح ثانٍ', actor: person() })),
      ),
    ).toBe('OPENING_NOT_REVERSIBLE');
    const states = await inCompany(companyId, (tx) =>
      tx.select({ state: openings.state }).from(openings).orderBy(openings.createdAt),
    );
    expect(states.map((row) => row.state)).toEqual(['reversed', 'posted']);
  });

  it('refuses forged rows: states, versions, stated lines and schedules (guards)', async () => {
    const { companyId } = await readyCompany();
    // A version skipped, and a line of a version that is not the save's.
    expect(
      await refusal(inCompany(companyId, (tx) => tx.update(openings).set({ version: 5 }))),
    ).toContain('adds one to the version');
    expect(
      await refusal(
        inCompany(companyId, async (tx) => {
          const [opening] = await tx.select().from(openings);
          await tx.insert(openingLines).values({
            companyId,
            openingId: opening?.id as string,
            version: opening?.version as number,
            lineNo: 9,
            accountId: await accountId(tx, '111001'),
            currency: 'SYP',
            amountMinor: 1n,
          });
        }),
      ),
    ).toContain('written by the save');
    // Posted with no entry of its own.
    expect(
      await refusal(
        inCompany(companyId, (tx) =>
          tx.update(openings).set({
            state: 'posted',
            entryId: uuidv7(),
            postedByUserId: personId,
            postedAt: new Date(),
            fingerprint: 'a'.repeat(64),
          }),
        ),
      ),
    ).toMatch(/posted with its entry|foreign key/);
    expect(await refusal(withCompany(owner, companyId, (tx) => tx.delete(openings)))).toContain(
      'openings',
    );
    const view = await inCompany(companyId, readOpening);
    await inCompany(companyId, (tx) =>
      postOpening(tx, { fingerprint: view.fingerprint, actor: person() }),
    );
    await inCompany(companyId, (tx) => manualEntry(tx));
    // A stated line on a manual entry.
    expect(
      await refusal(
        inCompany(companyId, async (tx) => {
          const [manual] = await tx
            .select()
            .from(journalEntries)
            .where(eq(journalEntries.source, 'manual'));
          const [line] = await tx
            .select()
            .from(journalLines)
            .where(eq(journalLines.entryId, manual?.id as string));
          await tx.insert(journalLines).values({
            ...(line as typeof journalLines.$inferInsert),
            id: uuidv7(),
            lineNo: 9,
            kind: 'stated',
          });
        }),
      ),
    ).toContain('stated line is only on an opening entry');
    // A schedule with neither an event nor an opening.
    expect(
      await refusal(
        inCompany(companyId, async (tx) => {
          const [schedule] = await tx.select().from(recognitionSchedules);
          await tx.insert(recognitionSchedules).values({
            ...(schedule as typeof recognitionSchedules.$inferInsert),
            id: uuidv7(),
            openingId: null,
            eventId: null,
          });
        }),
      ),
    ).toContain('recognition_schedules_one_source');
    // Nothing is dated before the books start.
    expect(await codeOf(inCompany(companyId, (tx) => manualEntry(tx, '2026-09-30')))).toBe(
      'PERIOD_CLOSED',
    );
  });

  it('shows another company nothing of it', async () => {
    const { companyId } = await readyCompany();
    const other = await newCompany();
    const seen = await inCompany(other, (tx) => tx.select().from(openings));
    expect(seen).toEqual([]);
    const view = await inCompany(other, readOpening);
    expect(view.opening).toBeNull();
    expect(view.snapshot).toBeNull();
    void companyId;
  });
});
