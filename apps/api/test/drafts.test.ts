import type { INestApplication } from '@nestjs/common';
import { auditEntries, type Database, withCompany } from '@vertex-mizan/db';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { type Books, books, draftOf, files, line, posted, purchase, today } from './books.js';
import { expectGuarded } from './guards.js';
import { testDatabase } from './people.js';

// The drafts of manual entries through the API (S03 rules 4–11, 17, acceptance steps 2 and 5–6):
// saving as typed, stale writes, the preview, posting once, approval by someone else, rejection,
// withdrawal, discarding and attachments, each as another company's member and without the
// permission too. Every value is synthetic.

let app: INestApplication;
let db: Database;

beforeAll(async () => {
  app = await createTestApp();
  db = testDatabase();
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

async function actions(companyId: string): Promise<string[]> {
  const rows = await withCompany(db, companyId, (tx) =>
    tx.select({ action: auditEntries.action }).from(auditEntries),
  );
  return rows.map((row) => row.action);
}

const approvalOn = async (book: Books) => {
  const switched = await book.owner.browser.patch('/api/company', { manualEntryApproval: true });
  expect(switched.status, JSON.stringify(switched.body)).toBe(200);
  expect(switched.body.manualEntryApproval).toBe(true);
};

describe('the guard on every draft route', () => {
  it('answers 401, 403, COMPANY_SWITCHED and COMPANY_ARCHIVED', async () => {
    const id = uuidv7();
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/drafts' },
      { method: 'post', path: '/api/drafts' },
      { method: 'get', path: `/api/drafts/${id}` },
      { method: 'put', path: `/api/drafts/${id}` },
      { method: 'post', path: `/api/drafts/${id}/post` },
      { method: 'post', path: `/api/drafts/${id}/submit` },
      { method: 'post', path: `/api/drafts/${id}/withdraw` },
      { method: 'post', path: `/api/drafts/${id}/discard` },
      { method: 'post', path: `/api/drafts/${id}/approve` },
      { method: 'post', path: `/api/drafts/${id}/reject` },
      { method: 'post', path: `/api/drafts/${id}/attachments` },
      { method: 'delete', path: `/api/drafts/${id}/attachments/${uuidv7()}` },
    ]);
  });

  it('refuses a draft to a person without drafts.read or drafts.manage', async () => {
    const book = await books(app, db);
    const viewer = await book.join('viewer');
    const approver = await book.join('approver');
    expect((await viewer.browser.get('/api/drafts')).body.code).toBe('FORBIDDEN');
    expect((await approver.browser.get('/api/drafts')).status).toBe(200);
    expect((await approver.browser.post('/api/drafts', purchase(book))).body.code).toBe(
      'FORBIDDEN',
    );
  });
});

describe('a draft, approval off (rules 4–7)', () => {
  it('saves as typed, refuses a stale write, previews, posts once and then never changes', async () => {
    const book = await books(app, db);
    const { browser } = book.owner;
    const draft = await draftOf(browser, {
      entryDate: today(),
      lines: [
        line(book, '111004', 'USD', '10000'),
        { accountId: null, currency: null, amountMinor: null },
      ],
    });
    const incomplete = await browser.post(`/api/drafts/${draft.id}/preview`);
    expect(incomplete.body.lines).toEqual([]);
    expect(
      incomplete.body.refusals.map((r: { code: string; lineNo: number | null }) => [
        r.code,
        r.lineNo,
      ]),
    ).toEqual([
      ['VALIDATION_FAILED', null],
      ['VALIDATION_FAILED', 2],
    ]);
    expect((await browser.post(`/api/drafts/${draft.id}/post`)).body.code).toBe(
      'VALIDATION_FAILED',
    );

    const saved = await browser.put(`/api/drafts/${draft.id}`, {
      ...purchase(book),
      updatedAt: draft.updatedAt,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.lines).toHaveLength(2);
    expect(saved.body.dealtRates).toEqual([{ base: 'USD', quote: 'SYP', rate: '122.5000' }]);
    // A second accountant still holding the first version.
    const stale = await browser.put(`/api/drafts/${draft.id}`, {
      ...purchase(book),
      updatedAt: draft.updatedAt,
    });
    expect(stale.body.code).toBe('DRAFT_CHANGED');

    const preview = await browser.post(`/api/drafts/${draft.id}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.refusals).toEqual([]);
    expect(
      preview.body.lines.map(
        (l: {
          accountCode: string;
          bookMinor: string;
          parallelMinor: string;
          kind: string;
          ledger: string | null;
        }) => [l.accountCode, l.kind, l.ledger, l.bookMinor, l.parallelMinor],
      ),
    ).toEqual([
      ['111004', 'measured', null, '1215000', '10000'],
      ['111003', 'measured', null, '-1225000', '-10000'],
      ['541001', 'difference', 'book', '10000', '0'],
    ]);

    const first = await browser.post(`/api/drafts/${draft.id}/post`);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.draft.state).toBe('posted');
    expect(first.body.entry).toMatchObject({ number: 1, draftId: draft.id, approvedBy: null });
    // A double click answers the same entry and posts nothing more.
    const again = await browser.post(`/api/drafts/${draft.id}/post`);
    expect(again.body.entry.id).toBe(first.body.entry.id);
    expect((await browser.get('/api/entries')).body.entries).toHaveLength(1);
    const late = await browser.put(`/api/drafts/${draft.id}`, {
      ...purchase(book),
      updatedAt: first.body.draft.updatedAt,
    });
    expect(late.body.code).toBe('DRAFT_NOT_EDITABLE');
    expect(await actions(book.companyId)).toEqual(
      expect.arrayContaining(['draft.created', 'draft.updated', 'entry.posted']),
    );
  });

  it('answers the refusals of the posting function in the preview and on posting', async () => {
    const book = await books(app, db);
    const { browser } = book.owner;
    const unbalanced = await draftOf(browser, {
      ...purchase(book),
      dealtRates: [],
      lines: [line(book, '111004', 'USD', '10000'), line(book, '111004', 'USD', '-9000')],
    });
    const preview = await browser.post(`/api/drafts/${unbalanced.id}/preview`);
    expect(preview.body.refusals.map((r: { code: string }) => r.code)).toEqual([
      'ENTRY_UNBALANCED',
    ]);
    expect((await browser.post(`/api/drafts/${unbalanced.id}/post`)).body.code).toBe(
      'ENTRY_UNBALANCED',
    );
    const control = await draftOf(browser, {
      ...purchase(book),
      lines: [line(book, '111004', 'USD', '10000'), line(book, '11', 'USD', '-10000')],
    });
    const refused = await browser.post(`/api/drafts/${control.id}/preview`);
    expect(refused.body.refusals[0]).toMatchObject({ code: 'ACCOUNT_NOT_POSTABLE', lineNo: 2 });
    // The draft stays as it was: nothing posted, nothing numbered.
    expect((await browser.get(`/api/drafts/${control.id}`)).body.state).toBe('draft');
  });

  it('refuses submitting with approval off, and discards a draft with its files', async () => {
    const book = await books(app, db);
    const { browser } = book.owner;
    const draft = await draftOf(browser, purchase(book));
    expect((await browser.post(`/api/drafts/${draft.id}/submit`)).body.code).toBe(
      'APPROVAL_NOT_REQUIRED',
    );
    expect(
      (await browser.upload(`/api/drafts/${draft.id}/attachments`, files.pdf, 'a.pdf')).status,
    ).toBe(201);
    const discarded = await browser.post(`/api/drafts/${draft.id}/discard`, { reason: 'مكرر' });
    expect(discarded.status).toBe(200);
    expect(discarded.body.archived.reason).toBe('مكرر');
    expect(discarded.body.attachments).toEqual([]);
    expect((await browser.post(`/api/drafts/${draft.id}/post`)).body.code).toBe(
      'DRAFT_NOT_EDITABLE',
    );
    expect((await browser.get('/api/drafts')).body.drafts).toEqual([]);
  });
});

describe('approval on (rule 8, acceptance step 5)', () => {
  it('is submitted, refused to its preparer and submitter, rejected with a reason, then approved', async () => {
    const book = await books(app, db);
    await approvalOn(book);
    expect(await actions(book.companyId)).toContain('company.settings_updated');
    const accountant = await book.join('accountant');
    const approver = await book.join('approver');
    const draft = await draftOf(accountant.browser, purchase(book));
    expect((await accountant.browser.post(`/api/drafts/${draft.id}/post`)).body.code).toBe(
      'APPROVAL_REQUIRED',
    );
    const submitted = await accountant.browser.post(`/api/drafts/${draft.id}/submit`);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body.state).toBe('submitted');
    expect(
      (
        await accountant.browser.put(`/api/drafts/${draft.id}`, {
          ...purchase(book),
          updatedAt: submitted.body.updatedAt,
        })
      ).body.code,
    ).toBe('DRAFT_NOT_EDITABLE');
    // The accountant holds no entries.approve; the owner who submitted nothing may approve.
    expect((await accountant.browser.post(`/api/drafts/${draft.id}/approve`)).body.code).toBe(
      'FORBIDDEN',
    );
    const queue = await approver.browser.get('/api/drafts', { view: 'awaiting' });
    expect(queue.body.drafts).toEqual([
      expect.objectContaining({ id: draft.id, lineCount: 2, state: 'submitted', rejected: false }),
    ]);

    const rejected = await approver.browser.post(`/api/drafts/${draft.id}/reject`, {
      reason: 'المرجع ناقص',
    });
    expect(rejected.body.state).toBe('draft');
    expect(rejected.body.rejected).toMatchObject({ reason: 'المرجع ناقص' });
    const fixed = await accountant.browser.put(`/api/drafts/${draft.id}`, {
      ...purchase(book),
      reference: 'REF-1',
      updatedAt: rejected.body.updatedAt,
    });
    expect(fixed.status).toBe(200);
    expect(
      (await accountant.browser.post(`/api/drafts/${draft.id}/submit`)).body.rejected,
    ).toBeNull();

    const approved = await approver.browser.post(`/api/drafts/${draft.id}/approve`);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.entry.approvedBy.id).toBe(approver.person.id);
    expect(approved.body.entry.preparedBy.id).toBe(accountant.person.id);
    // A second approver finds it posted (edge case 2).
    expect((await book.owner.browser.post(`/api/drafts/${draft.id}/approve`)).body.code).toBe(
      'DRAFT_NOT_EDITABLE',
    );
    expect(await actions(book.companyId)).toEqual(
      expect.arrayContaining(['draft.submitted', 'draft.rejected', 'draft.approved']),
    );
  });

  it('never lets the preparer or the submitter approve or reject (self-approval)', async () => {
    const book = await books(app, db);
    await approvalOn(book);
    const { browser } = book.owner;
    const draft = await draftOf(browser, purchase(book));
    await browser.post(`/api/drafts/${draft.id}/submit`);
    expect((await browser.post(`/api/drafts/${draft.id}/approve`)).body.code).toBe(
      'APPROVER_IS_PREPARER',
    );
    expect(
      (await browser.post(`/api/drafts/${draft.id}/reject`, { reason: 'نفسي' })).body.code,
    ).toBe('APPROVER_IS_PREPARER');
    // An accountant prepares, the owner submits nothing: the owner approves.
    const accountant = await book.join('accountant');
    const other = await draftOf(accountant.browser, purchase(book));
    await accountant.browser.post(`/api/drafts/${other.id}/submit`);
    expect((await browser.post(`/api/drafts/${other.id}/approve`)).status).toBe(200);
  });

  it('withdraws a submitted draft by its preparer, and keeps it submitted when approval goes off', async () => {
    const book = await books(app, db);
    await approvalOn(book);
    const { browser } = book.owner;
    const draft = await draftOf(browser, purchase(book));
    await browser.post(`/api/drafts/${draft.id}/submit`);
    expect((await browser.post(`/api/drafts/${draft.id}/discard`, {})).body.code).toBe(
      'DRAFT_NOT_EDITABLE',
    );
    const accountant = await book.join('accountant');
    expect((await accountant.browser.post(`/api/drafts/${draft.id}/withdraw`)).body.code).toBe(
      'FORBIDDEN',
    );
    expect((await browser.post(`/api/drafts/${draft.id}/withdraw`)).body.state).toBe('draft');
    await browser.post(`/api/drafts/${draft.id}/submit`);
    await browser.patch('/api/company', { manualEntryApproval: false });
    expect((await browser.get(`/api/drafts/${draft.id}`)).body.state).toBe('submitted');
    const approver = await book.join('approver');
    expect((await approver.browser.post(`/api/drafts/${draft.id}/approve`)).status).toBe(200);
  });
});

describe('attachments (rule 17, acceptance step 6)', () => {
  it('takes PDF and images by their first bytes, moves them to the entry, and serves them as downloads', async () => {
    const book = await books(app, db);
    const { browser } = book.owner;
    const draft = await draftOf(browser, purchase(book));
    const added = await browser.upload(
      `/api/drafts/${draft.id}/attachments`,
      files.pdf,
      'إيصال.pdf',
    );
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body).toMatchObject({
      fileName: 'إيصال.pdf',
      contentType: 'application/pdf',
      sizeBytes: files.pdf.length,
      draftId: draft.id,
      entryId: null,
    });
    const renamed = await browser.upload(
      `/api/drafts/${draft.id}/attachments`,
      files.html,
      'x.pdf',
    );
    expect(renamed.body.code).toBe('ATTACHMENT_TYPE');
    const big = await browser.upload(
      `/api/drafts/${draft.id}/attachments`,
      Buffer.concat([files.pdf, Buffer.alloc(10 * 1024 * 1024)]),
      'big.pdf',
    );
    expect(big.status).toBe(413);
    expect(big.body.code).toBe('ATTACHMENT_TOO_LARGE');
    const image = await browser.upload(
      `/api/drafts/${draft.id}/attachments`,
      files.png,
      'صورة.png',
    );
    const removed = await browser.delete(`/api/drafts/${draft.id}/attachments/${image.body.id}`);
    expect(removed.body.attachments.map((a: { id: string }) => a.id)).toEqual([added.body.id]);

    const viewer = await book.join('viewer');
    expect((await viewer.browser.get(`/api/attachments/${added.body.id}`)).body.code).toBe(
      'FORBIDDEN',
    );
    const result = await browser.post(`/api/drafts/${draft.id}/post`);
    expect(result.body.entry.attachments.map((a: { id: string }) => a.id)).toEqual([added.body.id]);
    const file = await viewer.browser.download(`/api/attachments/${added.body.id}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['content-disposition']).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('إيصال.pdf')}`,
    );
    expect(Buffer.compare(file.body as Buffer, files.pdf)).toBe(0);
    // Files are added to the posted entry, never removed from it (no route).
    expect(
      (await browser.upload(`/api/drafts/${draft.id}/attachments`, files.pdf, 'b.pdf')).body.code,
    ).toBe('DRAFT_NOT_EDITABLE');
    expect(await actions(book.companyId)).toEqual(
      expect.arrayContaining(['attachment.added', 'attachment.removed']),
    );
  });

  it('refuses the 21st file of a draft', async () => {
    const book = await books(app, db);
    const { browser } = book.owner;
    const draft = await draftOf(browser, purchase(book));
    for (let index = 0; index < 20; index += 1) {
      const added = await browser.upload(
        `/api/drafts/${draft.id}/attachments`,
        files.png,
        `${index}.png`,
      );
      expect(added.status).toBe(201);
    }
    const extra = await browser.upload(
      `/api/drafts/${draft.id}/attachments`,
      files.png,
      'extra.png',
    );
    expect(extra.body.code).toBe('ATTACHMENT_LIMIT');
  });
});

describe('another company', () => {
  it("never reads or changes another company's draft or file", async () => {
    const first = await books(app, db);
    const second = await books(app, db);
    const draft = await draftOf(first.owner.browser, purchase(first));
    const file = await first.owner.browser.upload(
      `/api/drafts/${draft.id}/attachments`,
      files.pdf,
      'a.pdf',
    );
    const other = second.owner.browser;
    expect((await other.get(`/api/drafts/${draft.id}`)).body.code).toBe('NOT_FOUND');
    expect((await other.post(`/api/drafts/${draft.id}/post`)).body.code).toBe('NOT_FOUND');
    expect((await other.post(`/api/drafts/${draft.id}/preview`)).body.code).toBe('NOT_FOUND');
    expect((await other.get(`/api/attachments/${file.body.id}`)).body.code).toBe('NOT_FOUND');
    expect((await other.get('/api/drafts')).body.drafts).toEqual([]);
  });

  it('refuses an account of another company at save', async () => {
    const first = await books(app, db);
    const second = await books(app, db);
    const created = await first.owner.browser.post('/api/drafts', {
      ...purchase(first),
      lines: [line(second, '111004', 'USD', '10000'), line(first, '111003', 'SYP', '-1225000')],
    });
    expect(created.body.code).toBe('VALIDATION_FAILED');
    expect(created.body.issues).toEqual([
      { path: ['lines', 0, 'accountId'], message: 'Unknown account' },
    ]);
  });
});

describe('a posted draft and the books', () => {
  it('numbers entries per fiscal year in posting order', async () => {
    const book = await books(app, db);
    const one = await posted(book.owner.browser, purchase(book));
    const two = await posted(book.owner.browser, purchase(book));
    expect([one.number, two.number]).toEqual([1, 2]);
    expect(one.fiscalYear).toBe(Number(today().slice(0, 4)));
  });
});
