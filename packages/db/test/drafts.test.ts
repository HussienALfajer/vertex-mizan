import {
  ATTACHMENT_CONTENT_TYPES,
  type CompanyLedgers,
  DomainError,
  DRAFT_STATES,
  LINE_KINDS,
} from '@vertex-mizan/contracts';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ATTACHMENT_TYPES,
  chartAccounts,
  createCompanyBooks,
  type Database,
  ENTRY_DRAFT_STATES,
  entryAttachments,
  entryDraftLines,
  entryDrafts,
  JOURNAL_LINE_KINDS,
  journalEntries,
  journalLines,
  lineConversions,
  type PersonActor,
  type PostingRequest,
  periods,
  post,
  postingRequests,
  previewPosting,
  recordRate,
  type Transaction,
  users,
  withCompany,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// S03's drafts module on the migrated database (0014, 0015): the guards of drafts, their lines and
// attachments, as the app role and the owner, and the preview, which builds the lines `post()`
// would post with no write. All values are synthetic.

const { app, owner } = connect();

const people: Record<'preparer' | 'submitter' | 'approver', string> = {
  preparer: '',
  submitter: '',
  approver: '',
};

const actor = (userId = people.preparer): PersonActor => ({
  kind: 'person',
  userId,
  name: 'محاسب تجريبي',
  sessionId: null,
  requestId: 'request-drafts-test',
  ipAddress: null,
  userAgent: null,
});

/** Vertex Media's shape: SYP books at the bulletin, a USD parallel ledger at market. */
const SYP_USD: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

const inCompany = <T>(
  companyId: string,
  work: (tx: Transaction) => Promise<T>,
  db: Database = app,
) => withCompany(db, companyId, work);

let company = '';
let accounts = new Map<string, string>();

async function newCompany(): Promise<string> {
  const id = uuidv7();
  await withCompany(app, id, (tx) =>
    createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة مسودات تجريبية',
        nameLatin: null,
        ledgers: SYP_USD,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'service-agency',
        createdByUserId: people.preparer,
      },
      actor(),
    ),
  );
  return id;
}

const draftRow = (values: Partial<typeof entryDrafts.$inferInsert> = {}) =>
  inCompany(company, async (tx) => {
    const [row] = await tx
      .insert(entryDrafts)
      .values({
        companyId: company,
        state: 'draft',
        entryDate: '2026-11-08',
        description: 'مسودة تجريبية',
        preparedByUserId: people.preparer,
        ...values,
      })
      .returning();
    if (!row) throw new Error('no draft inserted');
    return row;
  });

const changeDraft = (id: string, values: Partial<typeof entryDrafts.$inferInsert>, db = app) =>
  inCompany(company, (tx) => tx.update(entryDrafts).set(values).where(eq(entryDrafts.id, id)), db);

/** The S03 example's purchase of 100.00 USD for 12,250.00 SYP, dealt at 122.5000. */
const purchase = (
  draftId: string | null,
  approvedByUserId: string | null = null,
): PostingRequest => ({
  client: 'manual',
  idempotencyKey: draftId ?? uuidv7(),
  entryDate: '2026-11-08',
  description: 'شراء دولار',
  reference: null,
  draftId,
  preparedByUserId: people.preparer,
  approvedByUserId,
  actor: actor(approvedByUserId ?? people.preparer),
  content: {
    kind: 'manual',
    today: '2026-11-30',
    dealtRates: [{ base: 'USD', quote: 'SYP', rate: '122.5000' }],
    lines: [
      {
        accountId: accounts.get('111004') as string,
        dimensionValueIds: [],
        currency: 'USD',
        amountMinor: 10_000n,
        memo: null,
      },
      {
        accountId: accounts.get('111003') as string,
        dimensionValueIds: [],
        currency: 'SYP',
        amountMinor: -1_225_000n,
        memo: 'من الحساب بالليرة',
      },
    ],
  },
});

/** Posts a draft and marks it posted, in one transaction, as the drafts service does. */
const postDraft = (
  draftId: string,
  approvedByUserId: string | null = null,
  entryDraftId: string | null = draftId,
) =>
  inCompany(company, async (tx) => {
    const entry = await post(tx, purchase(entryDraftId, approvedByUserId));
    await tx
      .update(entryDrafts)
      .set({ state: 'posted', postedEntryId: entry.id })
      .where(eq(entryDrafts.id, draftId));
    return entry;
  });

const attach = (owner: { draftId: string } | { entryId: string }) =>
  inCompany(company, (tx) => {
    const id = uuidv7();
    return tx
      .insert(entryAttachments)
      .values({
        id,
        companyId: company,
        ...owner,
        fileName: 'إيصال.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
        sha256: 'b'.repeat(64),
        storageKey: `${company}/${id}`,
        uploadedByUserId: people.preparer,
      })
      .returning()
      .then(([row]) => row as typeof entryAttachments.$inferSelect);
  });

async function code(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  throw new Error('expected a refusal');
}

beforeAll(async () => {
  for (const key of Object.keys(people) as (keyof typeof people)[]) {
    const [row] = await app
      .insert(users)
      .values({ email: `drafts.${key}@example.test`, name: 'شخص تجريبي' })
      .returning({ id: users.id });
    people[key] = row?.id as string;
  }
  company = await newCompany();
  const rows = await inCompany(company, (tx) =>
    tx.select({ id: chartAccounts.id, code: chartAccounts.code }).from(chartAccounts),
  );
  accounts = new Map(rows.map((row) => [row.code, row.id]));
  for (const [type, value] of [
    ['bulletin', '121.5000'],
    ['market', '122.0000'],
  ] as const) {
    await inCompany(company, (tx) =>
      recordRate(tx, company, actor(), {
        effectiveOn: '2026-11-08',
        base: 'USD',
        quote: 'SYP',
        rate: value,
        type,
        source: 'manual',
      }),
    );
  }
});

describe('the drafts schema', () => {
  it('keeps the lists of contracts', () => {
    expect([...ENTRY_DRAFT_STATES]).toEqual([...DRAFT_STATES]);
    expect([...ATTACHMENT_TYPES]).toEqual([...ATTACHMENT_CONTENT_TYPES]);
    expect([...JOURNAL_LINE_KINDS]).toEqual([...LINE_KINDS]);
  });

  it('starts a draft unsubmitted, in the draft state', async () => {
    expect(await refusal(draftRow({ state: 'submitted' }))).toMatch(/starts unsubmitted/);
    expect(
      await refusal(draftRow({ submittedByUserId: people.preparer, submittedAt: new Date() })),
    ).toMatch(/starts unsubmitted/);
  });

  it('refuses a deletion of a draft, a line or an attachment for the app role and the owner', async () => {
    const draft = await draftRow();
    await inCompany(company, (tx) =>
      tx.insert(entryDraftLines).values({ companyId: company, draftId: draft.id, lineNo: 1 }),
    );
    await attach({ draftId: draft.id });
    for (const table of ['entry_drafts', 'entry_draft_lines', 'entry_attachments']) {
      const name = sql.identifier(table);
      expect(
        await refusal(inCompany(company, (tx) => tx.execute(sql`delete from ${name}`))),
      ).toMatch(/permission denied/);
      expect(
        await refusal(inCompany(company, (tx) => tx.execute(sql`delete from ${name}`), owner)),
      ).toMatch(/never deleted/);
      expect(
        await refusal(inCompany(company, (tx) => tx.execute(sql`truncate ${name}`), owner)),
      ).toMatch(/never deleted|referenced in a foreign key/);
    }
  });
});

describe('a draft and its posting', () => {
  it('posts once, to the entry posted from it, and then never changes', async () => {
    const draft = await draftRow();
    const entry = await postDraft(draft.id);
    const [stored] = await inCompany(company, (tx) =>
      tx.select().from(journalEntries).where(eq(journalEntries.id, entry.id)),
    );
    expect(stored?.draftId).toBe(draft.id);
    expect(await refusal(changeDraft(draft.id, { description: 'تعديل' }))).toMatch(
      /posted or discarded/,
    );
    expect(await refusal(changeDraft(draft.id, { description: 'تعديل' }, owner))).toMatch(
      /posted or discarded/,
    );
    // A second entry from the same draft, under another key: one draft posts once.
    expect(
      await refusal(
        inCompany(company, (tx) => post(tx, { ...purchase(draft.id), idempotencyKey: uuidv7() })),
      ),
    ).toMatch(/journal_entries_draft_key/);
  });

  it('refuses a draft marked posted with an entry not posted from it', async () => {
    const draft = await draftRow();
    const other = await inCompany(company, (tx) => post(tx, purchase(null)));
    expect(
      await refusal(changeDraft(draft.id, { state: 'posted', postedEntryId: other.id })),
    ).toMatch(/posts only as its own entry/);
    // Approved entries are posted from submitted drafts only.
    expect(await refusal(postDraft(draft.id, people.approver))).toMatch(
      /posts only as its own entry/,
    );
  });

  it('keeps a submitted draft read only, its state alone moving', async () => {
    const draft = await draftRow();
    await changeDraft(draft.id, {
      state: 'submitted',
      submittedByUserId: people.submitter,
      submittedAt: new Date(),
    });
    expect(await refusal(changeDraft(draft.id, { description: 'تعديل' }))).toMatch(/read only/);
    expect(await refusal(changeDraft(draft.id, { entryDate: '2026-11-09' }))).toMatch(/read only/);
    // Discarding needs a withdrawal first (S03 rule 11).
    expect(
      await refusal(changeDraft(draft.id, { archivedAt: new Date(), archivedReason: 'لا حاجة' })),
    ).toMatch(/entry_drafts_archived|read only/);
    expect(
      await refusal(
        inCompany(company, (tx) =>
          tx.insert(entryDraftLines).values({ companyId: company, draftId: draft.id, lineNo: 1 }),
        ),
      ),
    ).toMatch(/only while it is prepared/);
    await changeDraft(draft.id, { state: 'draft', submittedByUserId: null, submittedAt: null });
    await changeDraft(draft.id, { description: 'بعد السحب' });
  });

  it('is approved by nobody who prepared or submitted it (S03 rule 8)', async () => {
    const submit = async (submitter: string) => {
      const draft = await draftRow();
      await changeDraft(draft.id, {
        state: 'submitted',
        submittedByUserId: submitter,
        submittedAt: new Date(),
      });
      return draft.id;
    };
    // The preparer: the entry's own check refuses it.
    expect(await refusal(postDraft(await submit(people.submitter), people.preparer))).toMatch(
      /journal_entries_approver_not_preparer/,
    );
    // The submitter, who did not prepare it: the draft's guard refuses it.
    expect(await refusal(postDraft(await submit(people.submitter), people.submitter))).toMatch(
      /approved by another person/,
    );
    // Unapproved from a submitted draft.
    expect(await refusal(postDraft(await submit(people.submitter), null))).toMatch(
      /approved by another person/,
    );
    const approved = await postDraft(await submit(people.submitter), people.approver);
    expect(approved.replayed).toBe(false);
  });

  it('never changes a discarded draft, nor its lines', async () => {
    const draft = await draftRow();
    await inCompany(company, (tx) =>
      tx.insert(entryDraftLines).values({ companyId: company, draftId: draft.id, lineNo: 1 }),
    );
    await changeDraft(draft.id, { archivedAt: new Date(), archivedReason: 'لا حاجة' });
    expect(
      await refusal(changeDraft(draft.id, { archivedAt: null, archivedReason: null })),
    ).toMatch(/posted or discarded/);
    expect(
      await refusal(
        inCompany(company, (tx) =>
          tx
            .update(entryDraftLines)
            .set({ memo: 'تعديل' })
            .where(eq(entryDraftLines.draftId, draft.id)),
        ),
      ),
    ).toMatch(/only while it is prepared/);
  });

  it('keeps a line on its draft and number, and gives a reversal draft no lines', async () => {
    const draft = await draftRow();
    await inCompany(company, (tx) =>
      tx.insert(entryDraftLines).values({ companyId: company, draftId: draft.id, lineNo: 1 }),
    );
    expect(
      await refusal(
        inCompany(company, (tx) =>
          tx
            .update(entryDraftLines)
            .set({ lineNo: 2 })
            .where(eq(entryDraftLines.draftId, draft.id)),
        ),
      ),
    ).toMatch(/keeps its draft and number/);
    const entry = await inCompany(company, (tx) => post(tx, purchase(null)));
    const reversal = await draftRow({ reversesEntryId: entry.id });
    expect(
      await refusal(
        inCompany(company, (tx) =>
          tx
            .insert(entryDraftLines)
            .values({ companyId: company, draftId: reversal.id, lineNo: 1 }),
        ),
      ),
    ).toMatch(/only while it is prepared/);
    // One reversal of an entry waits at a time.
    expect(await refusal(draftRow({ reversesEntryId: entry.id }))).toMatch(
      /entry_drafts_open_reversal_key/,
    );
  });

  it('refuses a zero amount, a 501st line and an unknown account of another company', async () => {
    const draft = await draftRow();
    const line = (values: Partial<typeof entryDraftLines.$inferInsert>) =>
      inCompany(company, (tx) =>
        tx
          .insert(entryDraftLines)
          .values({ companyId: company, draftId: draft.id, lineNo: 1, ...values }),
      );
    expect(await refusal(line({ amountMinor: 0n }))).toMatch(/entry_draft_lines_amount/);
    expect(await refusal(line({ lineNo: 501 }))).toMatch(/entry_draft_lines_line_no/);
    const other = await newCompany();
    const [foreign] = await inCompany(other, (tx) =>
      tx.select({ id: chartAccounts.id }).from(chartAccounts).limit(1),
    );
    expect(await refusal(line({ accountId: foreign?.id as string }))).toMatch(
      /entry_draft_lines_account_fk/,
    );
  });
});

describe('attachments', () => {
  it('moves a draft’s files to the entry it posts, and never removes one from an entry', async () => {
    const draft = await draftRow();
    const kept = await attach({ draftId: draft.id });
    const removed = await attach({ draftId: draft.id });
    const archive = (id: string) =>
      inCompany(company, (tx) =>
        tx
          .update(entryAttachments)
          .set({ archivedAt: new Date(), archivedReason: 'ملف خاطئ' })
          .where(eq(entryAttachments.id, id)),
      );
    await archive(removed.id);
    expect(
      await refusal(
        inCompany(company, (tx) =>
          tx
            .update(entryAttachments)
            .set({ archivedAt: null, archivedReason: null })
            .where(eq(entryAttachments.id, removed.id)),
        ),
      ),
    ).toMatch(/never changes/);
    const other = await inCompany(company, (tx) => post(tx, purchase(null)));
    const move = (entryId: string) =>
      inCompany(company, (tx) =>
        tx.update(entryAttachments).set({ entryId }).where(eq(entryAttachments.id, kept.id)),
      );
    expect(await refusal(move(other.id))).toMatch(/moves only to the entry its draft posted/);
    const entry = await postDraft(draft.id);
    await move(entry.id);
    expect(await refusal(archive(kept.id))).toMatch(/never changes/);
    // Files are added to a posted entry, not to its posted draft.
    expect(await refusal(attach({ draftId: draft.id }))).toMatch(/only while it is prepared/);
    await attach({ entryId: entry.id });
    expect(
      await refusal(
        inCompany(company, (tx) =>
          tx
            .update(entryAttachments)
            .set({ fileName: 'آخر.pdf' })
            .where(eq(entryAttachments.id, kept.id)),
        ),
      ),
    ).toMatch(/never changes/);
  });

  it('takes 20 files on a draft and refuses the 21st', async () => {
    const draft = await draftRow();
    for (let index = 0; index < 20; index += 1) await attach({ draftId: draft.id });
    expect(await refusal(attach({ draftId: draft.id }))).toMatch(/20 files at most/);
  });

  it('refuses a file on both a draft and an entry, and a storage key of another company', async () => {
    const draft = await draftRow();
    const entry = await inCompany(company, (tx) => post(tx, purchase(null)));
    expect(
      await refusal(attach({ draftId: draft.id, entryId: entry.id } as { draftId: string })),
    ).toMatch(/to a draft or to an entry/);
    expect(
      await refusal(
        inCompany(company, (tx) =>
          tx.insert(entryAttachments).values({
            companyId: company,
            draftId: draft.id,
            fileName: 'إيصال.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1024,
            sha256: 'b'.repeat(64),
            storageKey: `${uuidv7()}/${uuidv7()}`,
            uploadedByUserId: people.preparer,
          }),
        ),
      ),
    ).toMatch(/entry_attachments_storage_key/);
  });
});

describe('previewPosting', () => {
  const rows = (tx: Transaction) =>
    Promise.all(
      [postingRequests, journalEntries, journalLines, lineConversions, periods].map((table) =>
        tx
          .select({ n: count() })
          .from(table)
          .then(([row]) => row?.n),
      ),
    );

  it('builds the lines post() posts, rounding and differences included, with no write', async () => {
    const request = purchase(null);
    const { preview, before, after } = await inCompany(company, async (tx) => {
      const before = await rows(tx);
      const preview = await previewPosting(tx, request);
      return { preview, before, after: await rows(tx) };
    });
    expect(after).toEqual(before);
    const entry = await inCompany(company, (tx) => post(tx, request));
    const posted = await inCompany(company, (tx) =>
      tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.entryId, entry.id))
        .orderBy(asc(journalLines.lineNo)),
    );
    expect(
      preview.map((line) => [
        line.accountId,
        line.kind,
        line.ledger,
        line.amountMinor,
        line.bookMinor,
        line.parallelMinor,
      ]),
    ).toEqual(
      posted.map((line) => [
        line.accountId,
        line.kind,
        line.ledger,
        line.amountMinor,
        line.bookMinor,
        line.parallelMinor,
      ]),
    );
    // The S03 example: 12,150.00 SYP on the USD bank line, a 100.00 SYP loss in the book only.
    expect(preview.map((line) => [line.bookMinor, line.parallelMinor])).toEqual([
      [1_215_000n, 10_000n],
      [-1_225_000n, -10_000n],
      [10_000n, 0n],
    ]);
    expect(preview[0]?.conversions.map((c) => [c.ledger, c.basis, c.rate])).toEqual([
      ['book', 'policy', '121.5'],
    ]);
    expect(preview[1]?.conversions.map((c) => [c.ledger, c.basis, c.rate])).toEqual([
      ['parallel', 'transaction', '122.5000'],
    ]);
  });

  it('refuses as post() does, naming the line', async () => {
    const request = purchase(null);
    const lines =
      request.content.kind === 'manual'
        ? request.content.lines.map((line, index) =>
            index === 1 ? { ...line, accountId: accounts.get('11') as string } : line,
          )
        : [];
    try {
      await inCompany(company, (tx) =>
        previewPosting(tx, { ...request, content: { ...request.content, lines } as never }),
      );
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).details?.lineNo).toBe(2);
    }
    expect(
      await code(
        inCompany(company, (tx) => previewPosting(tx, { ...request, entryDate: '2026-11-09' })),
      ),
    ).toBe('RATE_MISSING');
    expect(
      await code(
        inCompany(company, (tx) =>
          previewPosting(tx, {
            ...request,
            content: { ...request.content, today: '2026-10-28' } as never,
          }),
        ),
      ),
    ).toBe('ENTRY_DATE_OUT_OF_RANGE');
  });

  it('previews a reversal at the original amounts', async () => {
    const entry = await inCompany(company, (tx) => post(tx, purchase(null)));
    const lines = await inCompany(company, (tx) =>
      previewPosting(tx, {
        entryDate: '2026-11-20',
        content: { kind: 'reversal', entryId: entry.id, today: '2026-11-30' },
      }),
    );
    expect(
      lines.map((line) => [line.bookMinor, line.parallelMinor, line.conversions.length]),
    ).toEqual([
      [-1_215_000n, -10_000n, 0],
      [1_225_000n, 10_000n, 0],
      [-10_000n, 0n, 0],
    ]);
    const [stored] = await inCompany(company, (tx) =>
      tx
        .select({ n: count() })
        .from(journalEntries)
        .where(and(eq(journalEntries.reversesEntryId, entry.id))),
    );
    expect(stored?.n).toBe(0);
  });
});
