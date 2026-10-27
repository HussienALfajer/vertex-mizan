import type { Page, Request } from '@playwright/test';
import type { Me, RateRow, RecordedRate } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { companyId, owner, viewer } from './company-mocks';
import { bulletinRows, calendar, marketRows, rateReads, today, usdSyp } from './rate-mocks';
import { type ApiReply, expect, refusal, test } from './test';

const t = ar.rates;
const c = t.calendar;

/** Records each request a mock answers, to check what the page sent. */
function recorder(reply: ApiReply | ((request: Request) => ApiReply)) {
  const seen: Request[] = [];
  return {
    seen,
    mock: (request: Request) => {
      seen.push(request);
      return typeof reply === 'function' ? reply(request) : reply;
    },
  };
}

const currency = (code: 'USD' | 'SYP') => `${code} · ${ar.accounting.currencies[code]}`;

async function choose(page: Page, label: string, option: string) {
  const trigger = page.getByRole('combobox', { name: label, exact: true });
  // The list opens on its chosen item, so an option above it can sit out of view: by keyboard,
  // as a person would, moving through the currencies in their order.
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  const items = page.getByRole('option');
  await expect(items.first()).toBeVisible();
  const names = await items.allTextContents();
  const target = names.indexOf(option);
  const current = await items.evaluateAll((all) =>
    all.findIndex((item) => item.hasAttribute('data-highlighted')),
  );
  const key = target < current ? 'ArrowUp' : 'ArrowDown';
  for (let step = 0; step < Math.abs(target - current); step += 1) await page.keyboard.press(key);
  await expect(items.nth(target)).toHaveAttribute('data-highlighted', '');
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveText(option);
}

const reader: Me = { ...viewer, permissions: ['company.read', 'rates.read'] };

const wednesday = bulletinRows.find(
  (row) => row.effectiveOn === '2026-11-04' && !row.superseded,
) as RateRow;
const marketWednesday = marketRows[0] as RateRow;

test.describe('the bulletin calendar', () => {
  test.use({ me: owner, api: rateReads });

  test('keeps Friday and Saturday off and adds a Thursday holiday (step 5)', async ({ page }) => {
    const put = recorder((request) => ({
      status: 200,
      json: { ...calendar, daysOff: request.postDataJSON().daysOff },
    }));
    const add = recorder((request) =>
      request.postDataJSON().on === '2026-11-05'
        ? refusal(409, 'HOLIDAY_EXISTS')
        : {
            status: 201,
            json: { ...calendar.holidays[0], ...request.postDataJSON() },
          },
    );
    await page.route('**/api/rate-calendar', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill(put.mock(route.request()))
        : route.fallback(),
    );
    await page.route('**/api/rate-calendar/holidays', (route) =>
      route.fulfill(add.mock(route.request())),
    );
    await page.goto('/rates/calendar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(c.title);
    await expect(page.getByRole('checkbox', { name: t.weekdays[5] })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: t.weekdays[6] })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: t.weekdays[4] })).not.toBeChecked();
    // Nothing changed: nothing to save.
    await expect(page.getByRole('button', { name: c.save })).toBeDisabled();

    // Every weekday off is refused before it is sent.
    for (const day of [1, 2, 3, 4, 7] as const) {
      await page.getByRole('checkbox', { name: t.weekdays[day] }).click();
    }
    await page.getByRole('button', { name: c.save }).click();
    await expect(page.getByText(c.daysOffInvalid)).toBeVisible();
    expect(put.seen).toHaveLength(0);
    for (const day of [1, 2, 3, 4, 7, 6] as const) {
      await page.getByRole('checkbox', { name: t.weekdays[day] }).click();
    }
    await page.getByRole('button', { name: c.save }).click();
    await expect(page.getByText(c.saved)).toBeVisible();
    expect(put.seen[0]?.postDataJSON()).toEqual({ daysOff: [5] });
    expect(put.seen[0]?.headers()['x-mizan-company']).toBe(companyId);

    // A holiday already on the calendar, then a new one.
    await page.getByLabel(c.holidayOn, { exact: true }).fill('2026-11-05');
    await page.getByLabel(c.note, { exact: true }).fill('عطلة تجريبية');
    await page.getByRole('button', { name: c.add }).click();
    await expect(page.getByText(ar.errors.HOLIDAY_EXISTS)).toBeVisible();
    await page.getByLabel(c.holidayOn, { exact: true }).fill('2026-11-12');
    await page.getByRole('button', { name: c.add }).click();
    await expect(page.getByText(c.added)).toBeVisible();
    expect(add.seen[1]?.postDataJSON()).toEqual({ on: '2026-11-12', note: 'عطلة تجريبية' });
  });

  test('removes a holiday after confirming', async ({ page }) => {
    const remove = recorder({ status: 200, json: calendar.holidays[0] });
    await page.route('**/api/rate-calendar/holidays/*/remove', (route) =>
      route.fulfill(remove.mock(route.request())),
    );
    await page.goto('/rates/calendar');
    await expect(page.getByRole('cell', { name: 'عطلة تجريبية' })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`^${c.remove}: `) }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: c.remove }).click();
    await expect(dialog).toHaveCount(0);
    expect(remove.seen[0]?.url()).toContain(
      `/api/rate-calendar/holidays/${calendar.holidays[0]?.id}/remove`,
    );
  });
});

test.describe('rates', () => {
  test.use({ me: owner, api: rateReads });
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(today);
  });

  test('records a bulletin and a market rate for Wednesday (step 6)', async ({ page }) => {
    const record = recorder((request) => ({
      status: 201,
      json: {
        rate: { ...wednesday, ...request.postDataJSON(), superseded: false },
        superseded: null,
      } satisfies RecordedRate,
    }));
    await page.route('**/api/rates', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill(record.mock(route.request()))
        : route.fallback(),
    );
    await page.goto('/rates');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);

    await page.getByRole('button', { name: t.recordBulletin }).click();
    let dialog = page.getByRole('dialog', { name: t.record.bulletinTitle });
    // Today by default, and the pair on screen.
    await expect(dialog.getByLabel(t.record.effectiveOn)).toHaveValue('2026-11-09');
    await dialog.getByLabel(t.record.effectiveOn).fill('2026-11-04');
    await dialog.getByLabel(t.record.rate, { exact: true }).fill('١٢٠٫٠٠٠٠');
    // Enter commits the rate and submits.
    await dialog.getByLabel(t.record.rate, { exact: true }).press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(t.record.recorded)).toBeVisible();

    await page.getByRole('button', { name: t.recordMarket }).click();
    dialog = page.getByRole('dialog', { name: t.record.marketTitle });
    await dialog.getByLabel(t.record.effectiveOn).fill('2026-11-04');
    await dialog.getByLabel(t.record.rate, { exact: true }).fill('125.5000');
    await dialog.getByRole('button', { name: t.record.submit }).click();
    await expect(dialog).toHaveCount(0);

    expect(record.seen.map((request) => request.postDataJSON())).toEqual([
      {
        effectiveOn: '2026-11-04',
        base: 'USD',
        quote: 'SYP',
        rate: '120.0000',
        type: 'bulletin',
        source: 'manual',
      },
      {
        effectiveOn: '2026-11-04',
        base: 'USD',
        quote: 'SYP',
        rate: '125.5000',
        type: 'market',
        source: 'manual',
      },
    ]);
    expect(record.seen[0]?.headers()['x-mizan-company']).toBe(companyId);
  });

  test('answers the rate in force by the publication calendar (step 6)', async ({ page }) => {
    const asked: string[] = [];
    await page.route('**/api/rates/in-force*', (route) => {
      const url = new URL(route.request().url());
      const type = url.searchParams.get('type');
      const on = url.searchParams.get('on') ?? '';
      asked.push(`${type} ${on}`);
      if (type === 'market') {
        return route.fulfill({ status: 200, json: { rows: [marketWednesday], via: null } });
      }
      return on === '2026-11-08'
        ? route.fulfill({
            status: 422,
            json: {
              ...(refusal(422, 'RATE_MISSING').json as object),
              details: { publicationDay: '2026-11-08' },
            },
          })
        : route.fulfill({ status: 200, json: { rows: [wednesday], via: null } });
    });
    await page.goto('/rates');
    const inForce = page.getByRole('heading', { name: t.inForce.title }).locator('../..');
    for (const day of ['2026-11-05', '2026-11-06']) {
      await inForce.getByLabel(t.inForce.on).fill(day);
      await inForce.getByRole('button', { name: t.inForce.ask }).click();
      await expect(inForce.getByText(`1 USD = ${wednesday.rate} SYP`)).toBeVisible();
    }
    await inForce.getByLabel(t.inForce.on).fill('2026-11-08');
    await inForce.getByRole('button', { name: t.inForce.ask }).click();
    await expect(inForce.getByText(t.inForce.missing)).toBeVisible();
    await expect(inForce.getByText(t.inForce.missingBulletin)).toBeVisible();

    await page.getByRole('tab', { name: t.types.market }).click();
    const market = page.getByRole('heading', { name: t.inForce.title }).locator('../..');
    await market.getByLabel(t.inForce.on).fill('2026-11-08');
    await market.getByRole('button', { name: t.inForce.ask }).click();
    await expect(market.getByText(`1 USD = ${marketWednesday.rate} SYP`)).toBeVisible();
    expect(asked).toEqual([
      'bulletin 2026-11-05',
      'bulletin 2026-11-06',
      'bulletin 2026-11-08',
      'market 2026-11-08',
    ]);
  });

  test('refuses an inverted pair and corrects a rate with a reason (step 7)', async ({ page }) => {
    const superseded: RateRow = { ...wednesday, rate: '120', superseded: true };
    const record = recorder((request) => {
      const body = request.postDataJSON();
      if (body.base === 'SYP') return refusal(422, 'RATE_ORIENTATION');
      if (!body.reason) return refusal(422, 'RATE_REASON_REQUIRED');
      return {
        status: 201,
        json: {
          rate: {
            ...wednesday,
            id: '01900000-0000-7000-8007-000000000099',
            rate: '121',
            reason: body.reason,
            supersedesRateId: wednesday.id,
          },
          superseded,
        } satisfies RecordedRate,
      };
    });
    await page.route('**/api/rates', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill(record.mock(route.request()))
        : route.fallback(),
    );
    await page.goto('/rates');
    await page.getByRole('button', { name: t.recordBulletin }).click();
    const dialog = page.getByRole('dialog', { name: t.record.bulletinTitle });
    await choose(page, t.record.base, currency('SYP'));
    await choose(page, t.record.quote, currency('USD'));
    await dialog.getByLabel(t.record.effectiveOn).fill('2026-11-04');
    await dialog.getByLabel(t.record.rate, { exact: true }).fill('0.0083');
    await dialog.getByRole('button', { name: t.record.submit }).click();
    await expect(dialog.getByText(ar.errors.RATE_ORIENTATION)).toBeVisible();

    await choose(page, t.record.base, currency('USD'));
    await choose(page, t.record.quote, currency('SYP'));
    await dialog.getByLabel(t.record.rate, { exact: true }).fill('121.0000');
    await dialog.getByRole('button', { name: t.record.submit }).click();
    await expect(dialog.getByText(t.record.correctionTitle)).toBeVisible();
    await dialog.getByRole('button', { name: t.record.correct }).click();
    await expect(dialog.getByText(t.validation.reason)).toBeVisible();
    await dialog.getByLabel(t.record.reason).fill('تصحيح خطأ إدخال (مثال)');
    await dialog.getByRole('button', { name: t.record.correct }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(t.record.corrected)).toBeVisible();
    await expect(
      page.getByRole('status').getByText(`1 USD = ${superseded.rate} SYP`),
    ).toBeVisible();

    expect(record.seen.map((request) => request.postDataJSON())).toEqual([
      {
        effectiveOn: '2026-11-04',
        base: 'SYP',
        quote: 'USD',
        rate: '0.0083',
        type: 'bulletin',
        source: 'manual',
      },
      {
        effectiveOn: '2026-11-04',
        base: 'USD',
        quote: 'SYP',
        rate: '121.0000',
        type: 'bulletin',
        source: 'manual',
      },
      {
        effectiveOn: '2026-11-04',
        base: 'USD',
        quote: 'SYP',
        rate: '121.0000',
        type: 'bulletin',
        source: 'manual',
        reason: 'تصحيح خطأ إدخال (مثال)',
      },
    ]);
  });

  test('shows the rows with their corrections and the bulletin status of 30 days', async ({
    page,
  }) => {
    await page.goto('/rates');
    const table = page.getByRole('table', {
      name: `${t.table.label}: ${usdSyp.base} / ${usdSyp.quote} · ${t.types.bulletin}`,
    });
    await expect(table.getByText(t.table.superseded)).toBeVisible();
    await expect(table.getByText('تصحيح خطأ إدخال (مثال)')).toBeVisible();
    const days = page.getByRole('list', { name: t.status.label });
    await expect(days.getByRole('listitem')).toHaveCount(30);
    // Sunday 8 and Monday 9 November lack their bulletin, in text.
    await expect(days.getByText(`· ${t.status.missing}`)).toHaveCount(2);
    await expect(days.getByText(`· ${t.status.holiday}`)).toHaveCount(1);
    await expect(page.getByText(t.status.missingCount)).toBeVisible();
  });

  test('opens the bulletin record from the command palette', async ({ page }) => {
    await page.goto('/rates?record=bulletin');
    await expect(page.getByRole('dialog', { name: t.record.bulletinTitle })).toBeVisible();
    await page.getByRole('button', { name: ar.common.cancel }).click();
    await expect(page).toHaveURL(/\/rates$/);
  });
});

test.describe('rates for a reader', () => {
  test.use({ me: reader, api: rateReads });

  test('reads without recording (S02 access)', async ({ page }) => {
    await page.clock.setFixedTime(today);
    await page.goto('/rates');
    await expect(page.getByText(t.readOnly)).toBeVisible();
    await expect(page.getByRole('button', { name: t.recordBulletin })).toHaveCount(0);
    await page.getByRole('main').getByRole('link', { name: t.calendarLink }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(c.title);
    await expect(page.getByRole('checkbox', { name: t.weekdays[5] })).toBeDisabled();
    await expect(page.getByRole('button', { name: c.add })).toHaveCount(0);
  });
});
