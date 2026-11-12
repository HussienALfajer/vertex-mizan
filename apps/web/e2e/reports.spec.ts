import type { Page, Request } from '@playwright/test';
import { type Me, rolePermissions } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { owner } from './company-mocks';
import { typeOf } from './dimension-mocks';
import { purchase } from './entry-mocks';
import { today } from './rate-mocks';
import {
  cash,
  clientValue,
  designDepartment,
  prints,
  projectValue,
  receivables,
  reportFile,
  reportsReads,
  serviceHistory,
} from './reports-mocks';
import { type ApiReply, expect, test } from './test';

const t = ar.reports;
const p = t.journalScreen.print;

/** One test's own answer, before the shared mocks; it records each request it answers. */
async function answer(
  page: Page,
  method: string,
  path: string,
  reply: ApiReply | ((request: Request) => ApiReply),
): Promise<Request[]> {
  const seen: Request[] = [];
  await page.route(`**/api${path}`, (route) => {
    if (route.request().method() !== method) return route.fallback();
    seen.push(route.request());
    const sent = typeof reply === 'function' ? reply(route.request()) : reply;
    return sent.json === undefined
      ? route.fulfill({ status: sent.status })
      : route.fulfill({ status: sent.status, json: sent.json });
  });
  return seen;
}

const withRole = (role: 'viewer' | 'auditor'): Me => ({
  ...owner,
  memberships: owner.memberships.map((membership, index) =>
    index === 0 ? { ...membership, role } : membership,
  ),
  permissions: [...rolePermissions[role]],
});

const searchOf = (request: Request | undefined) =>
  new URL(request?.url() ?? 'http://x').searchParams;

async function openExport(page: Page, item: string) {
  await page.getByRole('button', { name: t.exportMenu.trigger }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test.use({ me: owner, api: reportsReads });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(today);
});

test.describe('the trial balance', () => {
  test('reads the month so far with its marks, totals and comparative', async ({ page }) => {
    const read = await answer(page, 'GET', '/reports/trial-balance?*', {
      status: 200,
      json: reportsReads['GET /api/reports/trial-balance'].json,
    });
    await page.goto('/reports/trial-balance');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.names.trial_balance);
    const search = searchOf(read[0]);
    expect(search.get('from')).toBe('2026-11-01');
    expect(search.get('to')).toBe('2026-11-09');
    expect(search.get('ledger')).toBe('book');

    // Both marks of an open, unrevalued month, each with its link.
    const marks = page.getByRole('region', { name: t.filters.label });
    await expect(marks).toContainText(t.marks.period_open);
    await expect(marks).toContainText(t.marks.before_revaluation);
    await expect(marks.getByRole('link', { name: t.markLinks.period })).toHaveAttribute(
      'href',
      '/periods/2026-11',
    );

    const table = page.getByRole('table', { name: /ميزان المراجعة/ });
    const cashRow = table.getByRole('row').filter({ hasText: cash.code });
    await expect(cashRow).toContainText('500,000.00');
    await expect(cashRow).toContainText('120,000.00');
    await expect(cashRow).toContainText('620,000.00');
    // A blocked account is marked; the totals balance, so no incident notice.
    await expect(table.getByRole('row').filter({ hasText: '411001' })).toContainText(t.blocked);
    await expect(table.getByRole('row').last()).toContainText('1,100,000.00');
    await expect(page.getByText(t.states.unbalanced)).toHaveCount(0);
  });

  test('opens a figure’s lines, and a line its entry', async ({ page }) => {
    const lines = await answer(page, 'GET', '/reports/lines?*', {
      status: 200,
      json: reportsReads['GET /api/reports/lines'].json,
    });
    await page.goto('/reports/trial-balance');
    const table = page.getByRole('table', { name: /ميزان المراجعة/ });
    const cashRow = table.getByRole('row').filter({ hasText: cash.code });
    await cashRow.getByRole('link', { name: t.drill.figure }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.lines.title);
    await expect.poll(() => lines.length).toBeGreaterThan(0);
    const search = searchOf(lines[0]);
    expect(search.get('account')).toBe(cash.id);
    expect(search.get('side')).toBe('debit');
    expect(search.get('from')).toBe('2026-11-01');
    expect(search.get('to')).toBe('2026-11-09');
    // The lines sum to the figure.
    await expect(page.getByText(t.lines.sum).locator('..')).toContainText('120,000.00');
    await page.getByRole('table', { name: t.lines.caption }).getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`/entries/${purchase.id}$`));
  });

  test('shows a credit figure’s lines on its side', async ({ page }) => {
    const lines = await answer(page, 'GET', '/reports/lines?*', {
      status: 200,
      json: { ...reportsReads['GET /api/reports/lines'].json, sum: '-12000000' },
    });
    await page.goto('/reports/trial-balance');
    const table = page.getByRole('table', { name: /ميزان المراجعة/ });
    // The receivables row's second linked figure is the period's credits.
    const row = table.getByRole('row').filter({ hasText: '112001' });
    await row.getByRole('link', { name: t.drill.figure }).nth(1).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.lines.title);
    await expect.poll(() => lines.length).toBeGreaterThan(0);
    expect(searchOf(lines[0]).get('side')).toBe('credit');
    const sum = page.locator('[data-side]');
    await expect(sum).toHaveAttribute('data-side', 'credit');
    await expect(sum).toContainText('120,000.00');
    await expect(sum).toContainText(t.columns.credit);
    await expect(sum).not.toContainText('-120,000.00');
  });

  test('applies a comparative only once both of its dates are set', async ({ page }) => {
    const read = await answer(page, 'GET', '/reports/trial-balance?*', {
      status: 200,
      json: reportsReads['GET /api/reports/trial-balance'].json,
    });
    await page.goto('/reports/trial-balance');
    await expect(page.getByRole('table', { name: /ميزان المراجعة/ })).toBeVisible();
    await page.getByLabel(t.filters.compareFrom).fill('2026-10-01');
    await expect(page.getByText(t.filters.invalidCompare)).toBeVisible();
    expect(read.every((request) => !searchOf(request).has('compareFrom'))).toBe(true);
    await page.getByLabel(t.filters.compareTo).fill('2026-10-31');
    await expect.poll(() => searchOf(read.at(-1)).get('compareTo')).toBe('2026-10-31');
    expect(searchOf(read.at(-1)).get('compareFrom')).toBe('2026-10-01');
    await expect(page.getByText(t.filters.invalidCompare)).toHaveCount(0);
  });

  test('moves between the figures with the arrow keys', async ({ page }) => {
    await page.goto('/reports/trial-balance');
    const table = page.getByRole('table', { name: /ميزان المراجعة/ });
    const first = table.getByRole('row').filter({ hasText: cash.code }).getByRole('link').first();
    await first.focus();
    await page.keyboard.press('ArrowDown');
    await expect(
      table.getByRole('row').filter({ hasText: '112001' }).getByRole('link').first(),
    ).toBeFocused();
  });

  test('switches to the parallel ledger and changes the level', async ({ page }) => {
    const read = await answer(page, 'GET', '/reports/trial-balance?*', {
      status: 200,
      json: reportsReads['GET /api/reports/trial-balance'].json,
    });
    await page.goto('/reports/trial-balance?level=2');
    await expect(page.getByRole('table', { name: /ميزان المراجعة/ })).toBeVisible();
    expect(searchOf(read[0]).get('level')).toBe('2');
    await page.getByRole('button', { name: new RegExp(ar.accounting.ledger.parallel) }).click();
    await expect.poll(() => searchOf(read.at(-1)).get('ledger')).toBe('parallel');
    await expect(page).toHaveURL(/ledger=parallel/);
  });

  test('exports to Excel at once and to PDF through the queue', async ({ page }) => {
    const excel: Request[] = [];
    await page.route('**/api/reports/trial_balance/export?*', (route) => {
      excel.push(route.request());
      return route.fulfill({
        status: 200,
        body: 'xlsx',
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': 'attachment; filename="trial-balance.xlsx"',
        },
      });
    });
    const file = reportFile('queued');
    const requested = await answer(page, 'POST', '/reports/files', { status: 201, json: file });
    let reads = 0;
    await answer(page, 'GET', `/reports/files/${file.id}`, () => {
      reads += 1;
      return { status: 200, json: reads < 2 ? file : reportFile('ready') };
    });
    await page.route(`**/api/reports/files/${file.id}/download`, (route) =>
      route.fulfill({
        status: 200,
        body: '%PDF',
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="trial-balance.pdf"',
        },
      }),
    );
    await page.goto('/reports/trial-balance');
    await expect(page.getByRole('table', { name: /ميزان المراجعة/ })).toBeVisible();

    const workbook = page.waitForEvent('download');
    await openExport(page, t.exportMenu.excel);
    expect((await workbook).suggestedFilename()).toBe('trial-balance.xlsx');
    const exported = searchOf(excel[0]);
    expect(exported.get('format')).toBe('xlsx');
    expect(exported.get('from')).toBe('2026-11-01');

    await openExport(page, t.exportMenu.pdf);
    await expect(page.getByRole('status').filter({ hasText: t.exportMenu.queued })).toBeVisible();
    expect(requested[0]?.postDataJSON()).toEqual({
      report: 'trial_balance',
      params: { from: '2026-11-01', to: '2026-11-09', ledger: 'book' },
    });
    const pdf = page.waitForEvent('download');
    await page.getByRole('button', { name: t.exportMenu.download }).click();
    expect((await pdf).suggestedFilename()).toBe('trial-balance.pdf');
  });
});

test.describe('the statements', () => {
  test('the income statement shows its lines, accounts and subtotals', async ({ page }) => {
    await page.goto('/reports/income-statement');
    const table = page.getByRole('table', { name: /قائمة الدخل/ });
    await expect(table).toContainText(t.statements.operatingProfit);
    await expect(table.getByRole('row').last()).toContainText(t.statements.profit);
    await expect(table.getByRole('row').last()).toContainText('682,400.00');
    // No investing amount: no profit before financing and income taxes.
    await expect(table).not.toContainText(t.statements.profitBeforeFinancingAndIncomeTaxes);
    await expect(table.getByRole('row').filter({ hasText: '511001' })).toContainText('-300,000.00');
    // A line opens its lines by its statement line over the period.
    const lines = await answer(page, 'GET', '/reports/lines?*', {
      status: 200,
      json: reportsReads['GET /api/reports/lines'].json,
    });
    await table
      .getByRole('row')
      .filter({ hasText: 'إيرادات العقود مع العملاء' })
      .first()
      .getByRole('link', { name: t.drill.figure })
      .first()
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.lines.title);
    await expect.poll(() => lines.length).toBeGreaterThan(0);
    const search = searchOf(lines[0]);
    expect(search.get('statementLine')).toBe('is.revenue');
    expect(search.get('from')).toBe('2026-11-01');
    expect(search.get('to')).toBe('2026-11-09');
  });

  test('the balance sheet notes a reclassification and balances', async ({ page }) => {
    await page.goto('/reports/balance-sheet');
    const table = page.getByRole('table', { name: /الميزانية/ });
    const receivablesLine = table
      .getByRole('row')
      .filter({ hasText: 'الذمم المدينة التجارية' })
      .first();
    await expect(receivablesLine).toContainText(`${t.statements.reclassified}: 2,400.00`);
    await expect(receivablesLine).toContainText('482,400.00');
    await expect(table.getByRole('row').filter({ hasText: t.statements.yearResult })).toContainText(
      '582,400.00',
    );
    await expect(
      table.getByRole('row').filter({ hasText: t.totals.liabilitiesAndEquity }),
    ).toContainText('1,402,400.00');
    await expect(table.getByRole('row').filter({ hasText: t.totals.assets })).toContainText(
      '1,402,400.00',
    );
    await expect(page.getByText(t.states.unbalanced)).toHaveCount(0);
    // A part the lines filter cannot isolate (no client, beside a client's part) has no link;
    // a client's part opens its lines by account and client.
    const parts = table.getByRole('row').filter({ hasText: '112001' });
    await expect(
      parts.filter({ hasText: '5,000.00', hasNotText: '475,000.00' }).getByRole('link'),
    ).toHaveCount(0);
    const lines = await answer(page, 'GET', '/reports/lines?*', {
      status: 200,
      json: reportsReads['GET /api/reports/lines'].json,
    });
    await parts
      .filter({ hasText: '475,000.00' })
      .getByRole('link', { name: t.drill.figure })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.lines.title);
    await expect.poll(() => lines.length).toBeGreaterThan(0);
    expect(searchOf(lines[0]).get('account')).toBe(receivables.id);
    expect(searchOf(lines[0]).get('client')).toBe(clientValue.id);
    expect(searchOf(lines[0]).get('to')).toBe('2026-11-09');
    await page.goBack();
    // A comparative with no posted line shows "—".
    await expect(table.getByRole('row').filter({ hasText: t.totals.assets })).toContainText(t.none);
  });
});

test.describe('profitability', () => {
  test('reads by department in the parallel ledger, unassigned last', async ({ page }) => {
    const read = await answer(page, 'GET', '/reports/profitability?*', {
      status: 200,
      json: reportsReads['GET /api/reports/profitability'].json,
    });
    await page.goto('/reports/profitability?by=department');
    const table = page.getByRole('table', { name: /تقرير الربحية/ });
    // Two heading rows: the comparative's group over its columns.
    const body = table.locator('tbody').getByRole('row');
    await expect(body.nth(0)).toContainText(designDepartment.name);
    await expect(body.nth(0)).toContainText('68.8%');
    await expect(body.nth(1)).toContainText(t.profitability.unassigned);
    await expect(body.nth(1)).toContainText(t.none);
    await expect(table.getByRole('row').last()).toContainText('300.00');
    const search = searchOf(read[0]);
    expect(search.get('by')).toBe('department');
    expect(search.get('ledger')).toBe('parallel');
  });
});

test.describe('the journal book', () => {
  test('refuses an official print of an open month, then prints a closed one', async ({ page }) => {
    let attempt = 0;
    const file = reportFile('queued', { report: 'journal_book', official: true });
    const requested = await answer(page, 'POST', '/reports/files', () => {
      attempt += 1;
      return attempt === 1
        ? {
            status: 422,
            json: {
              statusCode: 422,
              code: 'PERIOD_NOT_CLOSED',
              message: 'PERIOD_NOT_CLOSED',
              details: { period: '2026-11' },
            },
          }
        : { status: 201, json: file };
    });
    await answer(page, 'GET', `/reports/files/${file.id}`, {
      status: 200,
      json: reportFile('ready', { report: 'journal_book', official: true, expiresAt: null }),
    });
    await page.goto('/reports/journal');
    await expect(page.getByRole('table', { name: /اليومية العامة/ })).toContainText('PAY-0007');
    await page.getByRole('button', { name: p.open }).click();
    const dialog = page.getByRole('dialog', { name: p.title });
    await dialog.getByRole('button', { name: p.submit }).click();
    await expect(dialog.getByRole('alert')).toContainText('2026');
    await expect(dialog.getByRole('alert')).toContainText(p.notClosed.split(':')[1]?.trim() ?? '');
    expect(requested[0]?.postDataJSON()).toEqual({
      report: 'journal_book',
      params: { fiscalYear: '2026', from: '2026-11', to: '2026-11', ledger: 'book' },
      official: true,
    });

    await dialog.getByLabel(p.fromMonth).fill('2026-10');
    await dialog.getByLabel(p.toMonth).fill('2026-10');
    await dialog.getByRole('button', { name: p.submit }).click();
    await expect(dialog.getByRole('button', { name: t.exportMenu.download })).toBeVisible();
    expect(requested[1]?.postDataJSON()).toMatchObject({
      params: { from: '2026-10', to: '2026-10' },
      official: true,
    });
  });

  test('the register lists each print, a superseded one marked', async ({ page }) => {
    const read = await answer(page, 'GET', '/reports/journal-book/prints?*', {
      status: 200,
      json: prints,
    });
    await page.goto('/reports/journal-book/prints');
    const table = page.getByRole('table', { name: /طبعات دفتر اليومية الرسمية/ });
    await expect(table.getByRole('row').nth(1)).toContainText(t.prints.current);
    await expect(table.getByRole('row').nth(1)).toContainText('3–7');
    await expect(table.getByRole('row').nth(1)).toContainText('5,120,000.00');
    await expect(table.getByRole('row').nth(2)).toContainText(t.prints.superseded);
    await expect(table.getByRole('row').nth(2)).toContainText(t.prints.supersededAt);
    expect(searchOf(read[0]).get('fiscalYear')).toBe('2026');
  });

  test('the palette opens the print', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.shell.home.title);
    await page.keyboard.press('Control+k');
    await page
      .getByRole('combobox', { name: ar.commandPalette.search })
      .fill(t.palette.journalBook);
    await page.getByRole('option', { name: t.palette.journalBook }).click();
    await expect(page.getByRole('dialog', { name: p.title })).toBeVisible();
  });
});

test.describe('the reports index', () => {
  test('lists the reports and opens one with its last parameters', async ({ page }) => {
    await page.goto('/reports/trial-balance?level=2');
    await expect(page.getByRole('table', { name: /ميزان المراجعة/ })).toBeVisible();
    await page.goto('/reports');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.index.title);
    const card = page.getByRole('link', { name: new RegExp(t.names.trial_balance) });
    await expect(card).toContainText(t.index.lastShown);
    await card.click();
    await expect(page).toHaveURL(/level=2/);
  });

  test('every report offers Excel and PDF', async ({ page }) => {
    await page.goto('/reports/balance-sheet');
    await expect(page.getByRole('table', { name: /الميزانية/ })).toBeVisible();
    await page.getByRole('button', { name: t.exportMenu.trigger }).click();
    await expect(page.getByRole('menuitem', { name: t.exportMenu.pdf })).toBeVisible();
  });
});

test.describe('as a viewer', () => {
  test.use({ me: withRole('viewer') });

  test('sees a contract without the link to schedules it cannot open', async ({ page }) => {
    await page.goto('/reports/contract-position');
    const table = page.getByRole('table', { name: /مركز العقود/ });
    await expect(table).toContainText(projectValue.name);
    await expect(table.getByRole('link', { name: new RegExp(t.contracts.schedules) })).toHaveCount(
      0,
    );
  });

  test('reads every report from the sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.getByRole('link', { name: t.nav }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.index.title);
    await page.getByRole('link', { name: new RegExp(t.names.income_statement) }).click();
    await expect(page.getByRole('table', { name: /قائمة الدخل/ })).toBeVisible();
  });
});

test.describe('a service’s department', () => {
  test('shows its history and takes a new dated row', async ({ page }) => {
    const service = {
      id: serviceHistory.service.id,
      typeId: typeOf('service').id,
      code: 'logo',
      name: serviceHistory.service.name,
      nameLatin: null,
      contractKind: null,
      parentValueId: null,
      parentName: null,
      externalSource: null,
      externalId: null,
      archivedAt: null,
      createdAt: '2026-10-01T08:00:00.000Z',
    };
    await answer(page, 'GET', '/dimension-values?*', (request) => {
      const typeId = new URL(request.url()).searchParams.get('typeId');
      return {
        status: 200,
        json: { values: typeId === typeOf('service').id ? [service] : [], nextCursor: null },
      };
    });
    await answer(page, 'GET', `/dimension-values/${service.id}/departments`, {
      status: 200,
      json: serviceHistory,
    });
    const saved = await answer(page, 'POST', `/dimension-values/${service.id}/departments`, {
      status: 201,
      json: serviceHistory,
    });
    await page.goto('/dimensions');
    await page.getByRole('tab', { name: typeOf('service').name }).click();
    await page
      .getByRole('button', { name: `${ar.dimensions.departments.open}: ${service.name}` })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('table', { name: ar.dimensions.departments.caption }),
    ).toContainText('قسم التصميم');
    await dialog.getByRole('button', { name: ar.dimensions.departments.submit }).click();
    await expect(dialog.getByText(ar.dimensions.departments.required).first()).toBeVisible();
    expect(saved).toHaveLength(0);
  });
});
