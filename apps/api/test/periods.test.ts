import type { INestApplication } from '@nestjs/common';
import type { PeriodDetail, PeriodSummary } from '@vertex-mizan/contracts';
import type { Database } from '@vertex-mizan/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { type Books, books, draftOf, line, posted, today } from './books.js';
import { expectGuarded } from './guards.js';
import { joinCompany, testDatabase } from './people.js';

// S07's `/api/periods` over HTTP ("API", "Acceptance" tests): the months and a month's checklist
// and history with `periods.read` (owner, accountant, auditor), the close and the reopen with
// `periods.close` (the owner, an accountant with the period permission), each refusal of rules 2
// and 3, a posting refused in a closed month (rule 1),
// the audit rows, and another company's month read as an empty month of the caller's. The months
// come from the API's clock; every value is synthetic.

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

/** The month `back` months before today's in Damascus. */
function monthsAgo(back: number): string {
  const [year, month] = today().split('-').map(Number) as [number, number];
  const index = year * 12 + (month - 1) - back;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** An SYP expense the owner paid, dated `on`: no monetary balance, nothing to revalue. */
const expense = (book: Books, entryDate: string) => ({
  entryDate,
  description: 'اشتراك برمجي دفعه المالك',
  reference: null,
  dealtRates: [],
  lines: [line(book, '531004', 'SYP', '5000000'), line(book, '313001', 'SYP', '-5000000')],
});

/** Books with an SYP expense two months ago and one last month, the market rate of each. */
async function periodBooks() {
  const book = await books(app, db);
  const [earlier, last] = [monthsAgo(2), monthsAgo(1)];
  const recorded = await book.owner.browser.post('/api/rates', {
    effectiveOn: `${earlier}-01`,
    base: 'USD',
    quote: 'SYP',
    rate: '125.0000',
    type: 'market',
    source: 'manual',
  });
  expect(recorded.status, JSON.stringify(recorded.body)).toBe(201);
  await posted(book.owner.browser, expense(book, `${earlier}-15`));
  await posted(book.owner.browser, expense(book, `${last}-15`));
  return { book, earlier, last };
}

const reason = (text: string) => ({ reason: text });

describe('/api/periods', () => {
  it('closes in order with the period permission, refusing in rule 2 order', async () => {
    const { book, earlier, last } = await periodBooks();
    const owner = book.owner.browser;
    const current = today().slice(0, 7);
    const early = await owner.post(`/api/periods/${current}/close`, reason('إقفال مبكر'));
    expect([early.status, early.body.code]).toEqual([409, 'PERIOD_NOT_ENDED']);
    const order = await owner.post(`/api/periods/${last}/close`, reason('إقفال الشهر الماضي'));
    expect([order.status, order.body.code, order.body.details]).toEqual([
      409,
      'PERIOD_ORDER',
      { period: earlier },
    ]);
    const blank = await owner.post(`/api/periods/${earlier}/close`, reason('   '));
    expect(blank.body.code).toBe('VALIDATION_FAILED');

    const accountant = await book.join('accountant');
    const refused = await accountant.browser.post(`/api/periods/${earlier}/close`, reason('إقفال'));
    expect([refused.status, refused.body.code]).toEqual([403, 'FORBIDDEN']);
    const closer = await joinCompany(app, db, book.companyId, 'accountant', true);
    const closed = await closer.browser.post(`/api/periods/${earlier}/close`, reason('إقفال'));
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body as PeriodDetail).toMatchObject({
      period: earlier,
      state: 'closed',
      ended: true,
      firstPeriod: earlier,
      history: [{ kind: 'closed', reason: 'إقفال', user: { id: closer.person.id } }],
    });
    expect((closed.body as PeriodDetail).checklist.every((item) => item.result !== 'failed')).toBe(
      true,
    );
    const again = await owner.post(`/api/periods/${earlier}/close`, reason('مرة ثانية'));
    expect([again.status, again.body.code]).toEqual([409, 'PERIOD_CLOSED']);

    // A draft dated last month fails its checklist; its discard lets the month close.
    const draft = await draftOf(owner, expense(book, `${last}-20`));
    const failed = await owner.post(`/api/periods/${last}/close`, reason('إقفال'));
    expect([failed.status, failed.body.code, failed.body.details]).toEqual([
      409,
      'CHECKLIST_FAILED',
      { items: 'no_drafts' },
    ]);
    const detail = (await owner.get(`/api/periods/${last}`)).body as PeriodDetail;
    expect(detail.checklist.find((item) => item.item === 'no_drafts')).toEqual({
      item: 'no_drafts',
      result: 'failed',
      count: 1,
      ledgers: [],
    });
    const discarded = await owner.post(`/api/drafts/${draft.id}/discard`, reason('مكرر'));
    expect(discarded.status, JSON.stringify(discarded.body)).toBe(200);
    expect((await owner.post(`/api/periods/${last}/close`, reason('إقفال'))).status).toBe(200);

    // A posting into a closed month is refused.
    const draftInClosed = await draftOf(owner, expense(book, `${last}-25`));
    const posting = await owner.post(`/api/drafts/${draftInClosed.id}/post`);
    expect([posting.status, posting.body.code]).toEqual([409, 'PERIOD_CLOSED']);

    const list = await owner.get('/api/periods');
    expect(list.status).toBe(200);
    expect(
      (list.body as PeriodSummary[]).map((month) => [month.period, month.state, month.ended]),
    ).toEqual([
      [earlier, 'closed', true],
      [last, 'closed', true],
      [current, 'open', false],
    ]);
    expect((list.body as PeriodSummary[])[1]?.lastEvent).toMatchObject({ kind: 'closed' });
    const tooLong = await owner.get('/api/periods', { from: '2024-01', to: '2026-12' });
    expect(tooLong.body.code).toBe('VALIDATION_FAILED');
  });

  it('reopens the latest closed month only', async () => {
    const { book, earlier, last } = await periodBooks();
    const owner = book.owner.browser;
    for (const period of [earlier, last]) {
      const closed = await owner.post(`/api/periods/${period}/close`, reason(`إقفال ${period}`));
      expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    }
    const current = today().slice(0, 7);
    const order = await owner.post(`/api/periods/${earlier}/reopen`, reason('مراجعة'));
    expect([order.status, order.body.code, order.body.details]).toEqual([
      409,
      'PERIOD_ORDER',
      { period: last },
    ]);
    const open = await owner.post(`/api/periods/${current}/reopen`, reason('مراجعة'));
    expect([open.status, open.body.code]).toEqual([409, 'PERIOD_NOT_CLOSED']);
    const viewer = await book.join('viewer');
    expect(
      (await viewer.browser.post(`/api/periods/${last}/reopen`, reason('مراجعة'))).body.code,
    ).toBe('FORBIDDEN');
    const reopened = await owner.post(`/api/periods/${last}/reopen`, reason('فاتورة متأخرة'));
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    expect(reopened.body).toMatchObject({
      queuedEvents: 0,
      period: { period: last, state: 'reopened' },
    });
    await posted(owner, expense(book, `${last}-28`));

    const audit = await owner.get('/api/audit', { entityType: 'period' });
    expect(audit.status, JSON.stringify(audit.body)).toBe(200);
    expect(audit.body.entries.map((entry: { action: string }) => entry.action).sort()).toEqual([
      'period.closed',
      'period.closed',
      'period.reopened',
    ]);
  });

  it('reads by role, and shows another company none of it', async () => {
    const { book, earlier } = await periodBooks();
    await book.owner.browser.post(`/api/periods/${earlier}/close`, reason('إقفال'));
    for (const role of ['approver', 'viewer'] as const) {
      const member = await book.join(role);
      expect((await member.browser.get('/api/periods')).body.code, role).toBe('FORBIDDEN');
    }
    const auditor = await book.join('auditor');
    expect((await auditor.browser.get(`/api/periods/${earlier}`)).body).toMatchObject({
      state: 'closed',
    });
    expect(
      (await auditor.browser.post(`/api/periods/${earlier}/reopen`, reason('مراجعة'))).body.code,
    ).toBe('FORBIDDEN');
    const other = await books(app, db);
    expect((await other.owner.browser.get(`/api/periods/${earlier}`)).body).toMatchObject({
      period: earlier,
      state: 'open',
      firstPeriod: null,
      history: [],
    });
    const reopen = await other.owner.browser.post(`/api/periods/${earlier}/reopen`, reason('x'));
    expect(reopen.body.code).toBe('PERIOD_NOT_CLOSED');
    expect((await book.owner.browser.get(`/api/periods/${earlier}`)).body.state).toBe('closed');
  });

  it('guards every route', async () => {
    const period = monthsAgo(1);
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/periods' },
      { method: 'get', path: `/api/periods/${period}` },
      { method: 'post', path: `/api/periods/${period}/close` },
      { method: 'post', path: `/api/periods/${period}/reopen` },
    ]);
  });
});
