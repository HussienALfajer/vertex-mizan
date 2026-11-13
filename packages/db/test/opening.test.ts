import {
  accountStatementQuerySchema,
  balanceSheetQuerySchema,
  type CompanyLedgers,
  DomainError,
  generalLedgerQuerySchema,
  incomeStatementQuerySchema,
  OPENING_STATES,
  openingSnapshotSchema,
  REVENUE_MOVEMENT_KINDS,
  reportLinesQuerySchema,
  saveOpeningSchema,
  trialBalanceQuerySchema,
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
  openItems,
  openingLines,
  openingSnapshots,
  openings,
  type PersonActor,
  periods,
  post,
  postOpening,
  RECOGNITION_MOVEMENT_KINDS,
  readAccountStatement,
  readBalanceSheet,
  readGeneralLedger,
  readIncomeStatement,
  readOpening,
  readReportLines,
  readTrialBalance,
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

/** A forged journal entry header, as no posting function writes it. */
const forgedEntry = (companyId: string, source: string, entryDate: string) => ({
  companyId,
  requestId: uuidv7(),
  sequence: 99n,
  fiscalYear: 2026,
  number: 99,
  entryDate,
  postedAt: new Date(),
  source,
  description: 'قيد مزوّر',
  lineCount: 2,
  hash: 'f'.repeat(64),
});

const postAlone = (tx: Transaction, view: Awaited<ReturnType<typeof readOpening>>) =>
  post(tx, {
    client: 'manual',
    idempotencyKey: `opening:${view.opening?.id}`,
    entryDate: view.booksStart,
    description: 'قيد الأرصدة الافتتاحية',
    reference: null,
    draftId: null,
    preparedByUserId: personId,
    approvedByUserId: null,
    actor: person(),
    content: { ...(view.content as NonNullable<typeof view.content>) },
  });

describe('the opening guards against forged writes (S10)', () => {
  it('refuses an entry before the opening and before the books start, for every role', async () => {
    const companyId = await newCompany();
    for (const database of [app, owner]) {
      expect(
        await refusal(
          withCompany(database, companyId, (tx) =>
            tx.insert(journalEntries).values(forgedEntry(companyId, 'manual', '2026-10-05')),
          ),
        ),
      ).toContain('OPENING_NOT_POSTED');
      expect(
        await refusal(
          withCompany(database, companyId, (tx) =>
            tx.insert(journalEntries).values(forgedEntry(companyId, 'opening', '2026-10-05')),
          ),
        ),
      ).toContain('dated on the books start');
    }
    const { companyId: posted } = await readyCompany();
    const view = await inCompany(posted, readOpening);
    await inCompany(posted, (tx) =>
      postOpening(tx, { fingerprint: view.fingerprint, actor: person() }),
    );
    expect(
      await refusal(
        withCompany(owner, posted, (tx) =>
          tx.insert(journalEntries).values(forgedEntry(posted, 'manual', '2026-09-30')),
        ),
      ),
    ).toContain('before the books start');
  });

  it('refuses an opening entry without its opening, a stale snapshot, and a close or a period before it', async () => {
    const { companyId } = await readyCompany();
    const view = await inCompany(companyId, readOpening);
    // The posting function's entry alone: the opening is not posted with it.
    expect(await refusal(inCompany(companyId, (tx) => postAlone(tx, view)))).toContain(
      'without its opening',
    );
    // Posted with another snapshot than the latest.
    expect(
      await refusal(
        inCompany(companyId, async (tx) => {
          const entry = await postAlone(tx, view);
          await tx.update(openings).set({
            state: 'posted',
            entryId: entry.id,
            snapshotId: null,
            postedByUserId: personId,
            postedAt: new Date(),
            fingerprint: 'a'.repeat(64),
          });
        }),
      ),
    ).toContain('with the latest snapshot');
    for (const database of [app, owner]) {
      expect(
        await refusal(
          withCompany(database, companyId, (tx) =>
            tx
              .insert(periods)
              .values({ companyId, period: '2026-09', fiscalYear: 2026, state: 'open' }),
          ),
        ),
      ).toContain('before the books start');
      expect(
        await refusal(
          withCompany(database, companyId, async (tx) => {
            await tx
              .insert(periods)
              .values({ companyId, period: '2026-10', fiscalYear: 2026, state: 'open' })
              .onConflictDoNothing();
            await tx.update(periods).set({ state: 'closed' }).where(eq(periods.period, '2026-10'));
          }),
        ),
      ).toContain('OPENING_NOT_POSTED');
    }
  });

  it('refuses a reversal by hand once another entry stands, and a posted opening changed', async () => {
    const { companyId } = await readyCompany();
    const view = await inCompany(companyId, readOpening);
    await inCompany(companyId, (tx) =>
      postOpening(tx, { fingerprint: view.fingerprint, actor: person() }),
    );
    const manual = await inCompany(companyId, (tx) => manualEntry(tx));
    expect(
      await refusal(
        inCompany(companyId, (tx) => tx.update(openings).set({ fingerprint: 'b'.repeat(64) })),
      ),
    ).toContain('does not go from posted to posted');
    expect(
      await refusal(
        inCompany(companyId, (tx) =>
          tx.update(openings).set({
            state: 'reversed',
            reversalEntryId: manual.id,
            reversedByUserId: personId,
            reversedAt: new Date(),
            reverseReason: 'عكس مزوّر',
          }),
        ),
      ),
    ).toContain('OPENING_NOT_REVERSIBLE');
  });

  it("refuses a reference the opening's standing item holds, and forged schedules and movements", async () => {
    const { companyId } = await readyCompany();
    const view = await inCompany(companyId, readOpening);
    await inCompany(companyId, (tx) =>
      postOpening(tx, { fingerprint: view.fingerprint, actor: person() }),
    );
    for (const database of [app, owner]) {
      expect(
        await refusal(
          withCompany(database, companyId, async (tx) => {
            const [item] = await tx.select().from(openItems).where(eq(openItems.kind, 'document'));
            await tx.insert(openItems).values({
              ...(item as typeof openItems.$inferInsert),
              id: uuidv7(),
              source: 'manual',
              hubDocument: null,
            });
          }),
        ),
      ).toContain('stands on account');
    }
    // A schedule on an opening that is no longer a draft.
    expect(
      await refusal(
        inCompany(companyId, async (tx) => {
          const [schedule] = await tx.select().from(recognitionSchedules);
          await tx.insert(recognitionSchedules).values({
            ...(schedule as typeof recognitionSchedules.$inferInsert),
            id: uuidv7(),
            lineId: uuidv7(),
          });
        }),
      ),
    ).toContain('opened by its opening being posted');
    // A before_opening movement describing another entry than the opening's.
    expect(
      await refusal(
        inCompany(companyId, async (tx) => {
          const entry = await manualEntry(tx);
          const [schedule] = await tx.select().from(recognitionSchedules);
          await tx.insert(recognitionMovements).values({
            companyId,
            scheduleId: schedule?.id as string,
            kind: 'before_opening',
            month: '2026-08-01',
            entryId: entry.id,
            transactionMinor: -1n,
            bookMinor: -1n,
            parallelMinor: -1n,
          });
        }),
      ),
    ).toContain('on its opening entry');
  });
});

describe('the opening at once (S10 rules 7, 16)', () => {
  it('answers two identical snapshots at once with one stored, and two first saves with one', async () => {
    const companyId = await newCompany();
    const clientId = await newHubClient(companyId);
    const send = () =>
      inCompany(companyId, (tx) =>
        receiveOpeningSnapshot(tx, {
          companyId,
          apiClientId: clientId,
          snapshotKey: 'same-key',
          snapshot: snapshot(),
          actor: hubActor(clientId),
        }),
      );
    const answers = await Promise.all([send(), send()]);
    expect(answers.map((answer) => answer.replayed).sort()).toEqual([false, true]);
    expect(answers[0]?.snapshot_id).toBe(answers[1]?.snapshot_id);
    const saves = await Promise.all(
      [0, 1].map(() =>
        codeOf(inCompany(companyId, (tx) => save(tx, 0, false))).then((code) => code),
      ),
    );
    expect(saves.sort()).toEqual(['OPENING_CHANGED', 'none']);
  });

  it('refuses an income statement account on the opening, and a Hub slot line saved before Hub came', async () => {
    const companyId = await newCompany();
    await recordRates(companyId);
    expect(
      await codeOf(
        inCompany(companyId, async (tx) =>
          saveOpening(
            tx,
            saveOpeningSchema.parse({
              version: 0,
              lines: [
                { accountId: await accountId(tx, '411001'), currency: 'SYP', amount: '-100' },
              ],
              recordFigures: [],
            }),
            person(),
          ),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    // No Hub client yet: a receivable line saves; once Hub's client stands, the check fails.
    await inCompany(companyId, async (tx) =>
      saveOpening(
        tx,
        saveOpeningSchema.parse({
          version: 0,
          lines: [
            {
              accountId: await accountId(tx, '112001'),
              dimensionValueIds: [],
              currency: 'SYP',
              amount: '100',
              itemReference: 'OLD-1',
            },
          ],
          recordFigures: [],
        }),
        person(),
      ),
    );
    await newHubClient(companyId);
    const view = await inCompany(companyId, readOpening);
    const lines = view.checks.find((check) => check.check === 'lines');
    expect(lines?.failures).toEqual([{ lineNo: 1, code: 'VALIDATION_FAILED', reason: 'hub_slot' }]);
  });
});

describe('the opening in the reports (S10 rules 31–33)', () => {
  const NOW = new Date('2026-11-13T09:00:00Z');

  it('reads the opening entries as the opening balance, the period after them, and marks the reports', async () => {
    const { companyId } = await readyCompany();
    // Posted, reversed whole and posted again: entries 1, 2 and 3 on the books start.
    const first = await inCompany(companyId, readOpening);
    await inCompany(companyId, (tx) =>
      postOpening(tx, { fingerprint: first.fingerprint, actor: person() }),
    );
    await inCompany(companyId, (tx) =>
      reverseOpening(tx, { reason: 'تصحيح تجريبي', actor: person() }),
    );
    await inCompany(companyId, (tx) => save(tx, 0));
    const again = await inCompany(companyId, readOpening);
    await inCompany(companyId, (tx) =>
      postOpening(tx, { fingerprint: again.fingerprint, actor: person() }),
    );
    // A rent of the books start's own date, and one later: the period's lines.
    await inCompany(companyId, (tx) => manualEntry(tx, '2026-10-01'));
    await inCompany(companyId, (tx) => manualEntry(tx, '2026-10-05'));
    const cash = await inCompany(companyId, (tx) => accountId(tx, '111001'));

    for (const from of ['2026-10-01', '2026-09-01']) {
      const expectedMarks =
        from === '2026-10-01'
          ? ['before_revaluation', 'opening_entry', 'period_open']
          : ['before_books_start', 'before_revaluation', 'opening_entry', 'period_open'];
      const trial = await inCompany(companyId, (tx) =>
        readTrialBalance(
          tx,
          trialBalanceQuerySchema.parse({ from, to: '2026-10-31', compare: 'false' }),
          NOW,
        ),
      );
      expect(trial.header.booksStart).toBe('2026-10-01');
      expect([...trial.header.current.marks].sort()).toEqual(expectedMarks);
      expect(trial.rows.find((row) => row.account.id === cash)).toMatchObject({
        opening: '200000000',
        debits: '0',
        credits: '200',
        closing: '199999800',
      });
      expect(trial.totals.openingDebit).toBe(trial.totals.openingCredit);
      expect(trial.totals.debits).toBe('200');

      const ledger = await inCompany(companyId, (tx) =>
        readGeneralLedger(
          tx,
          generalLedgerQuerySchema.parse({
            from,
            to: '2026-10-31',
            codeFrom: '111001',
            codeTo: '111001',
          }),
          NOW,
        ),
      );
      expect([...ledger.header.current.marks].sort()).toEqual(expectedMarks);
      const [account] = ledger.accounts;
      expect(account?.opening).toBe('200000000');
      expect(account?.lines.map((line) => [line.entryDate, line.amount, line.balance])).toEqual([
        ['2026-10-01', '-100', '199999900'],
        ['2026-10-05', '-100', '199999800'],
      ]);

      const statement = await inCompany(companyId, (tx) =>
        readAccountStatement(
          tx,
          cash,
          accountStatementQuerySchema.parse({ from, to: '2026-10-31' }),
          NOW,
        ),
      );
      expect([...statement.header.current.marks].sort()).toEqual(expectedMarks);
      expect(statement.opening).toBe('200000000');
      expect(statement.lines).toHaveLength(2);
      expect(statement.currencies).toEqual([
        { currency: 'SYP', opening: '200000000', closing: '199999800' },
      ]);
    }

    // The drill-down: the opening column's lines sum to it; the period's leave them out.
    const lines = (query: Record<string, string>) =>
      inCompany(companyId, (tx) =>
        readReportLines(tx, reportLinesQuerySchema.parse({ account: cash, ...query }), NOW),
      );
    expect((await lines({ to: '2026-10-31', openingEntry: 'true' })).sum).toBe('200000000');
    expect((await lines({ from: '2026-10-01', to: '2026-10-31', side: 'debit' })).sum).toBe('0');
    expect((await lines({ from: '2026-10-01', to: '2026-10-31', side: 'credit' })).sum).toBe(
      '-200',
    );
    expect((await lines({ to: '2026-10-31' })).sum).toBe('199999800');

    // After the books start, the opening entry is in the balance before the range, unmarked.
    const november = await inCompany(companyId, (tx) =>
      readTrialBalance(
        tx,
        trialBalanceQuerySchema.parse({ from: '2026-11-01', to: '2026-11-30', compare: 'false' }),
        NOW,
      ),
    );
    expect(november.header.current.marks).toEqual(['period_open', 'before_revaluation']);
    expect(november.rows.find((row) => row.account.id === cash)?.opening).toBe('199999800');

    // Every income statement of 2026 says the result before the books start is in equity.
    const income = await inCompany(companyId, (tx) =>
      readIncomeStatement(
        tx,
        incomeStatementQuerySchema.parse({ from: '2026-11-01', to: '2026-11-30' }),
        NOW,
      ),
    );
    expect(income.header.current.marks).toContain('pre_opening_result_in_equity');
    expect(income.header.compare?.marks).toContain('pre_opening_result_in_equity');
    expect(income.header.current.marks).not.toContain('before_books_start');
    const sheet = await inCompany(companyId, (tx) =>
      readBalanceSheet(tx, balanceSheetQuerySchema.parse({ asOf: '2026-10-31' }), NOW),
    );
    expect(sheet.header.current.marks).not.toContain('opening_entry');
    expect(sheet.totals.assets).toBe(sheet.totals.liabilitiesAndEquity);
  });

  it('marks nothing of S10 in a company without a books start', async () => {
    const companyId = await newCompany(null);
    await recordRates(companyId);
    await inCompany(companyId, (tx) => manualEntry(tx, '2026-10-05'));
    const trial = await inCompany(companyId, (tx) =>
      readTrialBalance(
        tx,
        trialBalanceQuerySchema.parse({ from: '2026-01-01', to: '2026-10-31', compare: 'false' }),
        NOW,
      ),
    );
    expect(trial.header.booksStart).toBeNull();
    expect(trial.header.current.marks).not.toContain('opening_entry');
    expect(trial.header.current.marks).not.toContain('before_books_start');
    const income = await inCompany(companyId, (tx) =>
      readIncomeStatement(
        tx,
        incomeStatementQuerySchema.parse({ from: '2026-01-01', to: '2026-10-31' }),
        NOW,
      ),
    );
    expect(income.header.current.marks).not.toContain('pre_opening_result_in_equity');
  });
});
