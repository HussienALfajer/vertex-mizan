import type { INestApplication } from '@nestjs/common';
import {
  auditEntries,
  chainAnchors,
  companies,
  createDatabase,
  type Database,
  journalEntries,
  withCompany,
} from '@vertex-mizan/db';
import { desc, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestApp } from './app.js';
import { type Books, books, posted, purchase } from './books.js';
import { Browser } from './browser.js';
import { testDatabase } from './people.js';

// The integrity check through the API (S03 rule 19, acceptance step 7): a clean report with its
// counts, the stored anchors and a pasted one compared with the chain, the audit of each run, and
// who may run it. The breaks themselves are `packages/ledger`'s tests: the database's guards keep
// a forged entry out of this one. Every value is synthetic.

let app: INestApplication;
let db: Database;
let jobs: Database;

beforeAll(async () => {
  app = await createTestApp();
  db = testDatabase();
  jobs = createDatabase(inject('jobsUrl'));
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
  await jobs.$client.end();
});

const check = (browser: Browser, body: object = {}) => browser.post('/api/integrity/check', body);

/** The company's chain head as stored: its count and hash. */
const headOf = (book: Books) =>
  withCompany(db, book.companyId, async (tx) => {
    const [head] = await tx
      .select({
        id: journalEntries.id,
        sequence: journalEntries.sequence,
        hash: journalEntries.hash,
      })
      .from(journalEntries)
      .orderBy(desc(journalEntries.sequence))
      .limit(1);
    if (!head) throw new Error('no entry');
    return head;
  });

/** Today's anchor of the head, as the daily anchor job writes it as the jobs role. */
async function anchorToday(book: Books) {
  const head = await headOf(book);
  await jobs.insert(chainAnchors).values({
    companyId: book.companyId,
    anchoredOn: sql`(now() at time zone 'Asia/Damascus')::date`,
    entryCount: head.sequence,
    headEntryId: head.id,
    headHash: head.hash,
    emailOutboxIds: [],
  });
  const [stored] = await withCompany(db, book.companyId, (tx) =>
    tx.select({ anchoredOn: chainAnchors.anchoredOn }).from(chainAnchors),
  );
  return { ...head, anchoredOn: stored?.anchoredOn as string };
}

describe('POST /api/integrity/check', () => {
  it('reports clean books with their counts, and audits the run (acceptance step 7)', async () => {
    const book = await books(app, db);
    await posted(book.owner.browser, purchase(book));
    await posted(book.owner.browser, purchase(book, false));
    const head = await headOf(book);
    const response = await check(book.owner.browser);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual({
      checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      ok: true,
      entryCount: 2,
      // The dealt purchase has a difference line; the other has rounding or difference lines in
      // the parallel ledger.
      lineCount: expect.any(Number),
      firstBreak: null,
      head: { entryCount: 2, hash: head.hash, matchesChain: true },
      numbering: [],
      unbalanced: [],
      periodBalances: [],
      anchors: [],
      pasted: null,
    });
    const audit = await withCompany(db, book.companyId, (tx) =>
      tx
        .select({ action: auditEntries.action, after: auditEntries.after })
        .from(auditEntries)
        .where(eq(auditEntries.action, 'integrity.checked')),
    );
    expect(audit).toEqual([
      {
        action: 'integrity.checked',
        after: {
          ok: true,
          entryCount: 2,
          firstBreakSequence: null,
          problemCount: 0,
          anchorCount: 0,
          pastedResult: null,
        },
      },
    ]);
  });

  it('checks a company with no entries', async () => {
    const book = await books(app, db);
    const response = await check(book.owner.browser);
    expect(response.body).toMatchObject({
      ok: true,
      entryCount: 0,
      head: { entryCount: 0, hash: null, matchesChain: true },
    });
  });

  it('verifies the stored anchors and an anchor pasted from the email', async () => {
    const book = await books(app, db);
    await posted(book.owner.browser, purchase(book));
    const anchor = await anchorToday(book);
    await posted(book.owner.browser, purchase(book));
    const pasted = { date: anchor.anchoredOn, count: 1, hash: anchor.hash };
    const response = await check(book.owner.browser, { anchor: pasted });
    expect(response.body).toMatchObject({
      ok: true,
      entryCount: 2,
      anchors: [
        { anchoredOn: anchor.anchoredOn, entryCount: 1, headHash: anchor.hash, result: 'verified' },
      ],
      pasted: { anchor: pasted, result: 'verified', stored: 'same' },
    });
  });

  it('fails on a pasted anchor the chain does not hold, or one the server stored differently', async () => {
    const book = await books(app, db);
    await posted(book.owner.browser, purchase(book));
    const anchor = await anchorToday(book);
    const other = 'e'.repeat(64);
    const cases = [
      [{ date: anchor.anchoredOn, count: 1, hash: other }, 'mismatch', 'different', false],
      [{ date: anchor.anchoredOn, count: 5, hash: anchor.hash }, 'missing', 'different', false],
      // No anchor stored that day: the chain alone decides.
      [{ date: '2026-01-01', count: 1, hash: anchor.hash }, 'verified', 'none', true],
    ] as const;
    for (const [pasted, result, stored, ok] of cases) {
      const response = await check(book.owner.browser, { anchor: pasted });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.pasted).toEqual({ anchor: pasted, result, stored });
      expect(response.body.ok).toBe(ok);
    }
  });

  it('refuses a malformed anchor', async () => {
    const book = await books(app, db);
    const response = await check(book.owner.browser, {
      anchor: { date: '2026-11-08', count: 0, hash: 'ABC' },
    });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('is for the owner and the auditor, in their company only, archived or not', async () => {
    const book = await books(app, db);
    await posted(book.owner.browser, purchase(book));
    const auditor = await book.join('auditor');
    expect((await check(auditor.browser)).body).toMatchObject({ ok: true, entryCount: 1 });
    for (const role of ['accountant', 'approver', 'viewer'] as const) {
      const member = await book.join(role);
      expect((await check(member.browser)).body.code, role).toBe('FORBIDDEN');
    }
    expect((await check(new Browser(app))).status).toBe(401);
    expect(
      (await book.owner.browser.post('/api/integrity/check', {}, { 'x-mizan-company': uuidv7() }))
        .body.code,
    ).toBe('COMPANY_SWITCHED');
    // Another company's owner checks their own books: none of these entries.
    const other = await books(app, db);
    expect((await check(other.owner.browser)).body).toMatchObject({ entryCount: 0 });
    await db
      .update(companies)
      .set({ archivedAt: new Date(), archivedReason: 'شركة اختبار مؤرشفة' })
      .where(eq(companies.id, book.companyId));
    expect((await check(book.owner.browser)).body).toMatchObject({ ok: true, entryCount: 1 });
  });
});
