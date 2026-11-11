import type { INestApplication } from '@nestjs/common';
import type {
  Company,
  Entry,
  InboxCounts,
  InboxEventDetail,
  InboxPage,
  PostingRule,
} from '@vertex-mizan/contracts';
import { auditEntries, type Database, withCompany } from '@vertex-mizan/db';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestApp } from './app.js';
import { books, posted, purchase, today } from './books.js';
import { expectGuarded } from './guards.js';
import { hubClient, hubDocuments, invoiceIssued, paymentRecorded, projectEvents } from './hub.js';
import { testDatabase } from './people.js';

// S05's inbox and posting rules over HTTP (rules 15–18, "Mapping slots"): the events with their
// holds, counts and history, the accountant's retry and resolution, the owner's dismissal, the
// mapping, and the payments' tolerance. A move needs a closed period, which S07 makes; its success
// runs in `packages/db/test/inbox.test.ts`. Every value is synthetic.

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

/** Closes a month as S07 will; here the owner role closes it, as the ledger tests close months. */
async function closeMonth(companyId: string, period: string) {
  const owner = new pg.Client({ connectionString: inject('ownerUrl') });
  await owner.connect();
  try {
    await owner.query('begin');
    await owner.query(`select set_config('app.company_id', $1, true)`, [companyId]);
    await owner.query('alter table periods disable trigger period_rules');
    await owner.query(
      `insert into periods (id, company_id, period, fiscal_year, state) values ($1, $2, $3, $4, 'closed')`,
      [uuidv7(), companyId, period, Number(period.slice(0, 4))],
    );
    await owner.query('alter table periods enable always trigger period_rules');
    await owner.query('commit');
  } finally {
    await owner.end();
  }
}

/** The month before today's, `YYYY-MM`, and its last day. */
function lastMonth(): { period: string; lastDay: string } {
  const [year, month] = today().split('-').map(Number) as [number, number];
  const period = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  const end = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
  return { period, lastDay: end };
}

/** An SYP payment of a USD invoice whose applied amount is 50.00 USD off at Hub's rate. */
function gapPayment(documents: ReturnType<typeof hubDocuments>) {
  const payment = paymentRecorded(documents, today());
  return {
    ...payment,
    payload: { ...payment.payload, currency: 'SYP', amount: 6_100_000, applied_amount: 45_000 },
  };
}

describe('GET /api/inbox', () => {
  it('lists the events with their holds and entries, filters them and counts the held', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    const documents = hubDocuments();
    const held = await hub.send(paymentRecorded(documents, today()));
    const issued = await hub.send(invoiceIssued(documents, today()));
    expect([held.status, issued.status]).toEqual([202, 201]);

    const page = await book.owner.browser.get('/api/inbox');
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    const { events } = page.body as InboxPage;
    expect(events.map((event) => [event.type, event.state, event.reason])).toEqual([
      ['invoice.issued', 'posted', null],
      ['payment.recorded', 'held', 'UNKNOWN_REFERENCE'],
    ]);
    expect(events[0]).toMatchObject({
      documentType: 'invoice',
      documentNumber: documents.invoice.number,
      clientName: documents.client.name,
      accountingDate: today(),
      entries: [{ id: issued.body.entries[0].id }],
    });
    // The entry names its Hub document and its event; the item it opened names the event too.
    const entry = await book.owner.browser.get(`/api/entries/${issued.body.entries[0].id}`);
    expect(entry.body).toMatchObject({
      source: 'hub_event',
      sourceRef: issued.body.inbox_id,
      hubDocument: { type: 'invoice', id: documents.invoice.id, number: documents.invoice.number },
    });
    const itemId = (entry.body as Entry).lines.find((line) => line.item)?.item?.id;
    const item = await book.owner.browser.get(`/api/open-items/${itemId}`);
    expect(item.body).toMatchObject({ hubEventId: issued.body.inbox_id });
    const heldOnly = await book.owner.browser.get('/api/inbox', { state: 'held' });
    expect((heldOnly.body as InboxPage).events).toHaveLength(1);
    const byType = await book.owner.browser.get('/api/inbox', { type: 'invoice.issued' });
    expect((byType.body as InboxPage).events).toHaveLength(1);
    const byDocument = await book.owner.browser.get('/api/inbox', {
      document: documents.invoice.number,
    });
    // A payment names no client: its invoice does.
    expect(events[1]).toMatchObject({
      type: 'payment.recorded',
      clientName: documents.client.name,
    });
    expect((byDocument.body as InboxPage).events.map((event) => event.type)).toEqual([
      'invoice.issued',
    ]);
    expect((await book.owner.browser.get('/api/inbox', { type: 'invoice.unknown' })).status).toBe(
      422,
    );
    const counts = await book.owner.browser.get('/api/inbox/counts');
    expect(counts.body as InboxCounts).toEqual({
      held: 1,
      reasons: [{ reason: 'UNKNOWN_REFERENCE', count: 1 }],
    });

    const detail = await book.owner.browser.get(`/api/inbox/${held.body.inbox_id}`);
    expect(detail.status).toBe(200);
    const event = detail.body as InboxEventDetail;
    expect(event.payload).toMatchObject({ method: 'bank_transfer', amount: 50_000 });
    // Only an event held PERIOD_CLOSED has a day to move to.
    expect(event.moveOn).toBeNull();
    expect(event.actions.map((action) => action.action)).toEqual(['received', 'held']);
    expect(event.actions[0]?.actor).toMatchObject({ kind: 'api_client', id: hub.id });
    // The auditor reads; another company's id is not found.
    const auditor = await book.join('auditor');
    expect((await auditor.browser.get('/api/inbox')).status).toBe(200);
    const viewer = await book.join('viewer');
    expect((await viewer.browser.get('/api/inbox')).body.code).toBe('FORBIDDEN');
    const other = await books(app, db);
    expect((await other.owner.browser.get(`/api/inbox/${held.body.inbox_id}`)).body.code).toBe(
      'NOT_FOUND',
    );
  });

  it('answers the day a move posts on, and the move posts on it', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    // An invoice dated in last month, its rates recorded, and last month closed: S07 brings the
    // close; here the owner role closes it, as the ledger tests close months.
    const [year, month] = today().split('-').map(Number) as [number, number];
    const last = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
    const dated = `${last}-15`;
    for (const [type, rate] of [
      ['bulletin', '120.0000'],
      ['market', '120.5000'],
    ] as const) {
      const recorded = await book.owner.browser.post('/api/rates', {
        effectiveOn: dated,
        base: 'USD',
        quote: 'SYP',
        rate,
        type,
        source: 'manual',
      });
      expect(recorded.status, JSON.stringify(recorded.body)).toBe(201);
    }
    await closeMonth(book.companyId, last);
    const held = await hub.send(invoiceIssued(hubDocuments(), dated));
    expect(held.body).toMatchObject({ status: 'held', reason: 'PERIOD_CLOSED' });
    const thisMonth = `${today().slice(0, 7)}-01`;
    const detail = await book.owner.browser.get(`/api/inbox/${held.body.inbox_id}`);
    expect((detail.body as InboxEventDetail).moveOn).toBe(thisMonth);
    const moved = await book.owner.browser.post(
      `/api/inbox/${held.body.inbox_id}/post-in-open-period`,
      { reason: 'وصلت الفاتورة بعد الإقفال' },
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const after = moved.body as InboxEventDetail;
    expect([after.state, after.reason, after.detail]).toEqual(['posted', null, null]);
    expect(after).toMatchObject({ postedOn: thisMonth, moveOn: null });
  });

  it('answers the guard on every route', async () => {
    const id = uuidv7();
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/inbox' },
      { method: 'get', path: '/api/inbox/counts' },
      { method: 'get', path: `/api/inbox/${id}` },
      { method: 'post', path: `/api/inbox/${id}/retry` },
      { method: 'post', path: `/api/inbox/${id}/post-in-open-period` },
      { method: 'post', path: `/api/inbox/${id}/recognise-in-open-period` },
      { method: 'post', path: `/api/inbox/${id}/split-remainder` },
      { method: 'post', path: `/api/inbox/${id}/resolve` },
      { method: 'post', path: `/api/inbox/${id}/dismiss` },
      { method: 'get', path: '/api/posting-rules' },
      { method: 'put', path: '/api/posting-rules/receivable' },
    ]);
  });
});

describe('the accountant’s actions', () => {
  it('retry a held payment once its invoice posted, and refuse a posted event', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    const documents = hubDocuments();
    const held = await hub.send(paymentRecorded(documents, today()));
    await hub.send(invoiceIssued(documents, today()));
    const accountant = await book.join('accountant');
    const retried = await accountant.browser.post(`/api/inbox/${held.body.inbox_id}/retry`);
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body).toMatchObject({ state: 'posted', reason: null });
    expect((retried.body as InboxEventDetail).entries).toHaveLength(1);
    expect((retried.body as InboxEventDetail).actions.map((action) => action.action)).toContain(
      'retried',
    );
    const again = await accountant.browser.post(`/api/inbox/${held.body.inbox_id}/retry`);
    expect(again.body.code).toBe('EVENT_NOT_HELD');
    // A move needs PERIOD_CLOSED; a resolution NEEDS_DECISION.
    const other = await hub.send(paymentRecorded(hubDocuments(), today()));
    const move = await accountant.browser.post(
      `/api/inbox/${other.body.inbox_id}/post-in-open-period`,
      { reason: 'نقل تجريبي' },
    );
    expect(move.body.code).toBe('EVENT_ACTION_NOT_ALLOWED');
    const entry = await posted(book.owner.browser, purchase(book));
    const resolve = await accountant.browser.post(`/api/inbox/${other.body.inbox_id}/resolve`, {
      entryId: entry.id,
      reason: 'معالجة يدوية',
    });
    expect(resolve.body.code).toBe('EVENT_ACTION_NOT_ALLOWED');
  });

  it('resolve a payment beyond the tolerance by a manual entry, once', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    const documents = hubDocuments();
    await hub.send(invoiceIssued(documents, today()));
    const payment = gapPayment(documents);
    const held = await hub.send(payment);
    expect(held.body).toMatchObject({
      status: 'held',
      reason: 'NEEDS_DECISION',
      detail: 'payment_gap_beyond_tolerance',
    });
    const accountant = await book.join('accountant');
    const hubEntry = await hub.send(invoiceIssued(hubDocuments(), today()));
    const notManual = await accountant.browser.post(`/api/inbox/${held.body.inbox_id}/resolve`, {
      entryId: hubEntry.body.entries[0].id,
      reason: 'قيد من Hub',
    });
    expect(notManual.body.code).toBe('ENTRY_ALREADY_LINKED');
    const entry = await posted(book.owner.browser, purchase(book));
    const resolved = await accountant.browser.post(`/api/inbox/${held.body.inbox_id}/resolve`, {
      entryId: entry.id,
      reason: 'الفرق خارج التسامح، عولج بقيد يدوي',
    });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    expect(resolved.body).toMatchObject({ state: 'resolved', resolvedBy: { id: entry.id } });
    // Hub's replay answers the resolution, with no entry of its own.
    const replay = await hub.send(payment);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual({ status: 'resolved', inbox_id: held.body.inbox_id, entries: [] });
  });

  it('dismiss is the owner’s, with a reason, and the event never returns to held', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    const held = await hub.send(paymentRecorded(hubDocuments(), today()));
    const accountant = await book.join('accountant');
    const path = `/api/inbox/${held.body.inbox_id}/dismiss`;
    expect((await accountant.browser.post(path, { reason: 'خطأ' })).body.code).toBe('FORBIDDEN');
    expect((await book.owner.browser.post(path, {})).body.code).toBe('VALIDATION_FAILED');
    const dismissed = await book.owner.browser.post(path, { reason: 'دفعة مكررة في Hub' });
    expect(dismissed.status, JSON.stringify(dismissed.body)).toBe(200);
    const event = dismissed.body as InboxEventDetail;
    expect(event.state).toBe('dismissed');
    expect(event.actions.at(-1)).toMatchObject({
      action: 'dismissed',
      note: 'دفعة مكررة في Hub',
      actor: { kind: 'person', id: book.owner.person.id },
    });
    expect((await book.owner.browser.post(path, { reason: 'مرة ثانية' })).body.code).toBe(
      'EVENT_NOT_HELD',
    );
    const audit = await withCompany(db, book.companyId, (tx) =>
      tx.select({ action: auditEntries.action }).from(auditEntries),
    );
    expect(audit.map((row) => row.action)).toContain('event.dismissed');
  });
});

describe('another company', () => {
  it('finds no event, entry or account of another company for an action or a mapping', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    const documents = hubDocuments();
    await hub.send(invoiceIssued(documents, today()));
    const held = await hub.send(gapPayment(documents));
    expect(held.body.reason).toBe('NEEDS_DECISION');
    const other = await books(app, db);
    const otherHub = await hubClient(app, other.owner);
    const otherHeld = await otherHub.send(paymentRecorded(hubDocuments(), today()));
    const otherEntry = await posted(other.owner.browser, purchase(other));
    const accountant = await book.join('accountant');
    // The other company's event, by its id, from this company's accountant and owner.
    const id = otherHeld.body.inbox_id as string;
    for (const [browser, path, body] of [
      [accountant.browser, `/api/inbox/${id}/retry`, undefined],
      [accountant.browser, `/api/inbox/${id}/post-in-open-period`, { reason: 'نقل' }],
      [accountant.browser, `/api/inbox/${id}/recognise-in-open-period`, { reason: 'اعتراف' }],
      [
        accountant.browser,
        `/api/inbox/${id}/split-remainder`,
        { revenueAmount: '0', reason: 'تقسيم' },
      ],
      [accountant.browser, `/api/inbox/${id}/resolve`, { entryId: otherEntry.id, reason: 'حل' }],
      [book.owner.browser, `/api/inbox/${id}/dismiss`, { reason: 'إلغاء' }],
    ] as const) {
      const answer = await browser.post(path, body);
      expect(answer.body.code, path).toBe('NOT_FOUND');
    }
    // This company's event resolved by the other company's posted manual entry.
    const crossEntry = await accountant.browser.post(`/api/inbox/${held.body.inbox_id}/resolve`, {
      entryId: otherEntry.id,
      reason: 'قيد شركة أخرى',
    });
    expect(crossEntry.body.code).toBe('NOT_FOUND');
    // A slot mapped to the other company's account.
    const crossAccount = await accountant.browser.put('/api/posting-rules/receivable', {
      accountId: other.accounts.get('112001'),
    });
    expect(crossAccount.body.code).toBe('NOT_FOUND');
    // The other company's event still held, untouched.
    const still = await other.owner.browser.get(`/api/inbox/${id}`);
    expect(still.body).toMatchObject({ state: 'held', reason: 'UNKNOWN_REFERENCE' });
  });
});

describe('/api/posting-rules', () => {
  it('lists every slot with the template’s account and maps a slot to an account that fits', async () => {
    const book = await books(app, db);
    const listed = await book.owner.browser.get('/api/posting-rules');
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const rules = listed.body as PostingRule[];
    // S05's thirteen and S06's four.
    expect(rules).toHaveLength(17);
    expect(rules.find((rule) => rule.slot === 'receivable')).toMatchObject({
      currency: null,
      account: { code: '112001' },
      events: ['invoice.issued'],
      heldEvents: 0,
    });
    expect(
      rules.find((rule) => rule.slot === 'payment_method.cash' && rule.currency === 'USD')?.account
        ?.code,
    ).toBe('111002');

    const accountant = await book.join('accountant');
    const unfit = await accountant.browser.put('/api/posting-rules/receivable', {
      accountId: book.accounts.get('411001'),
    });
    expect(unfit.body.code).toBe('MAPPING_ACCOUNT_INVALID');
    const wrongCurrency = await accountant.browser.put('/api/posting-rules/payment_method.cash', {
      currency: 'USD',
      accountId: book.accounts.get('111001'),
    });
    expect(wrongCurrency.body.code).toBe('MAPPING_ACCOUNT_INVALID');
    const noCurrency = await accountant.browser.put('/api/posting-rules/payment_method.cash', {
      accountId: book.accounts.get('111002'),
    });
    expect(noCurrency.body.code).toBe('VALIDATION_FAILED');
    const unknown = await accountant.browser.put('/api/posting-rules/receivable', {
      accountId: uuidv7(),
    });
    expect(unknown.body.code).toBe('NOT_FOUND');

    const mapped = await accountant.browser.put('/api/posting-rules/payment_method.cash', {
      currency: 'USD',
      accountId: book.accounts.get('111004'),
    });
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(200);
    expect(mapped.body).toMatchObject({ currency: 'USD', account: { code: '111004' } });
    const audit = await withCompany(db, book.companyId, (tx) =>
      tx
        .select({
          action: auditEntries.action,
          before: auditEntries.before,
          after: auditEntries.after,
        })
        .from(auditEntries),
    );
    expect(audit.filter((row) => row.action === 'posting_rule.mapped')).toEqual([
      {
        action: 'posting_rule.mapped',
        before: expect.objectContaining({ accountCode: '111002' }),
        after: expect.objectContaining({ accountCode: '111004', slot: 'payment_method.cash' }),
      },
    ]);
    const viewer = await book.join('viewer');
    expect((await viewer.browser.get('/api/posting-rules')).body.code).toBe('FORBIDDEN');
  });
});

describe('a control account’s slot', () => {
  it('keeps its account while it holds open items, and moves on a fresh company', async () => {
    const receivables = async (book: Awaited<ReturnType<typeof books>>) => {
      const created = await book.owner.browser.post('/api/accounts', {
        parentId: book.accounts.get('112'),
        code: '112009',
        kind: 'postable',
        name: 'ذمم عملاء أخرى',
        statementLine: 'bs.trade_receivables',
        isMonetary: true,
        isControl: true,
        itemKind: 'document',
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      return created.body.id as string;
    };
    const book = await books(app, db);
    const second = await receivables(book);
    const hub = await hubClient(app, book.owner);
    expect((await hub.send(invoiceIssued(hubDocuments(), today()))).status).toBe(201);
    const refused = await book.owner.browser.put('/api/posting-rules/receivable', {
      accountId: second,
    });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      code: 'ACCOUNT_HAS_BALANCE',
      details: { code: '112001' },
    });
    const fresh = await books(app, db);
    const freshSecond = await receivables(fresh);
    const moved = await fresh.owner.browser.put('/api/posting-rules/receivable', {
      accountId: freshSecond,
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.account.code).toBe('112009');
  });
});

describe('the payments’ tolerance', () => {
  it('is 1.00 in each currency by default and changed by the owner, audited', async () => {
    const book = await books(app, db);
    const before = (await book.owner.browser.get('/api/company')).body as Company;
    expect([before.paymentToleranceSyp, before.paymentToleranceUsd]).toEqual(['100', '100']);
    const changed = await book.owner.browser.patch('/api/company', { paymentToleranceUsd: '500' });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect((changed.body as Company).paymentToleranceUsd).toBe('500');
    expect(
      (await book.owner.browser.patch('/api/company', { paymentToleranceSyp: '-1' })).body.code,
    ).toBe('VALIDATION_FAILED');
    const audit = await withCompany(db, book.companyId, (tx) =>
      tx.select({ action: auditEntries.action, after: auditEntries.after }).from(auditEntries),
    );
    expect(audit).toContainEqual({
      action: 'company.settings_updated',
      after: { paymentToleranceUsdMinor: '500' },
    });
  });
});

describe('POST /api/inbox/:id/recognise-in-open-period (S06 rule 16)', () => {
  it('posts a closed month’s elapsed part in the first open period, with a reason', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    const { period, lastDay } = lastMonth();
    for (const [type, rate] of [
      ['bulletin', '119.0000'],
      ['market', '119.5000'],
    ] as const) {
      const recorded = await book.owner.browser.post('/api/rates', {
        effectiveOn: lastDay,
        base: 'USD',
        quote: 'SYP',
        rate,
        type,
        source: 'manual',
      });
      expect(recorded.status, JSON.stringify(recorded.body)).toBe(201);
    }
    await closeMonth(book.companyId, period);
    // A manual line deferred over last month and this one, issued today: last month has elapsed.
    const documents = hubDocuments();
    const event = invoiceIssued(documents, today());
    const [line] = event.payload.lines;
    // The template's contract liabilities and assets name the contract (S06 rule 1's manual case).
    const contract = {
      external_id: uuidv7(),
      name: 'مشروع تجريبي',
      kind: 'project',
      client_external_id: documents.client.external_id,
    };
    const late = {
      ...event,
      payload: {
        ...event.payload,
        contract,
        lines: [
          {
            ...line,
            source: 'manual',
            deferred: true,
            cycle_start: `${period}-01`,
            cycle_end: today(),
          },
        ],
      },
    };
    const held = await hub.send(late);
    expect(held.body).toMatchObject({ status: 'held', reason: 'SERVICE_PERIOD_CLOSED' });
    const path = `/api/inbox/${held.body.inbox_id}/recognise-in-open-period`;
    const viewer = await book.join('viewer');
    expect((await viewer.browser.post(path, { reason: 'سبب' })).body.code).toBe('FORBIDDEN');
    const accountant = await book.join('accountant');
    expect((await accountant.browser.post(path, {})).body.code).toBe('VALIDATION_FAILED');
    const recognised = await accountant.browser.post(path, {
      reason: 'أُغلق الشهر قبل وصول الفاتورة؛ الجزء غير جوهري',
    });
    expect(recognised.status, JSON.stringify(recognised.body)).toBe(200);
    const detail = recognised.body as InboxEventDetail;
    expect(detail.state, JSON.stringify([detail.reason, detail.detail])).toBe('posted');
    expect(detail.actions.at(-1)).toMatchObject({
      action: 'recognised_in_open_period',
      note: 'أُغلق الشهر قبل وصول الفاتورة؛ الجزء غير جوهري',
    });
    const entries = await Promise.all(
      detail.entries.map(
        async (entry) => (await book.owner.browser.get(`/api/entries/${entry.id}`)).body as Entry,
      ),
    );
    // The elapsed part on the first day of this month; the invoice on its own date.
    expect(entries.map((entry) => entry.entryDate)).toEqual([`${today().slice(0, 7)}-01`, today()]);
    expect((await accountant.browser.post(path, { reason: 'مرة ثانية' })).body.code).toBe(
      'EVENT_NOT_HELD',
    );
    const audit = await withCompany(db, book.companyId, (tx) =>
      tx.select({ action: auditEntries.action }).from(auditEntries),
    );
    expect(audit.map((row) => row.action)).toContain('event.recognised_in_open_period');
    // Another reason's hold is not recognised.
    const other = await hub.send(paymentRecorded(hubDocuments(), today()));
    const refused = await accountant.browser.post(
      `/api/inbox/${other.body.inbox_id}/recognise-in-open-period`,
      { reason: 'سبب' },
    );
    expect(refused.body.code).toBe('EVENT_ACTION_NOT_ALLOWED');
  });
});

describe('POST /api/inbox/:id/split-remainder (S06 rules 15–16)', () => {
  it('splits a cancelled project’s remainder with a reason, within zero to the remainder', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    const project = projectEvents(hubDocuments(), today());
    expect((await hub.send(project.deposit())).status).toBe(201);
    const held = await hub.send(project.cancelled());
    expect(held.body).toMatchObject({
      status: 'held',
      reason: 'NEEDS_DECISION',
      detail: 'cancelled_project_remainder',
    });
    const path = `/api/inbox/${held.body.inbox_id}/split-remainder`;
    const viewer = await book.join('viewer');
    const body = { revenueAmount: '10000', reason: 'ثلث الدفعة مستحق عن العمل المنجز' };
    expect((await viewer.browser.post(path, body)).body.code).toBe('FORBIDDEN');
    const accountant = await book.join('accountant');
    expect((await accountant.browser.post(path, { reason: 'سبب' })).body.code).toBe(
      'VALIDATION_FAILED',
    );
    // Above the 300.00 USD remainder: refused, nothing written.
    const above = await accountant.browser.post(path, { ...body, revenueAmount: '30001' });
    expect(above.body.code).toBe('VALIDATION_FAILED');
    const split = await accountant.browser.post(path, body);
    expect(split.status, JSON.stringify(split.body)).toBe(200);
    const detail = split.body as InboxEventDetail;
    expect([detail.state, detail.reason]).toEqual(['posted', null]);
    expect(detail.entries).toHaveLength(1);
    expect(detail.actions.at(-1)).toMatchObject({ action: 'remainder_split', note: body.reason });
    const [entry] = detail.entries;
    const lines = ((await book.owner.browser.get(`/api/entries/${entry?.id}`)).body as Entry).lines;
    expect(lines.map((line) => [line.accountCode, line.amountMinor])).toEqual(
      expect.arrayContaining([
        ['212001', '30000'],
        ['411001', '-10000'],
        ['211003', '-20000'],
      ]),
    );
    expect((await accountant.browser.post(path, body)).body.code).toBe('EVENT_NOT_HELD');
    const audit = await withCompany(db, book.companyId, (tx) =>
      tx.select({ action: auditEntries.action, after: auditEntries.after }).from(auditEntries),
    );
    expect(audit.find((row) => row.action === 'event.remainder_split')?.after).toMatchObject({
      revenueMinor: '10000',
    });
    // Another reason's hold is not split.
    const other = await hub.send(paymentRecorded(hubDocuments(), today()));
    const refused = await accountant.browser.post(
      `/api/inbox/${other.body.inbox_id}/split-remainder`,
      body,
    );
    expect(refused.body.code).toBe('EVENT_ACTION_NOT_ALLOWED');
  });
});
