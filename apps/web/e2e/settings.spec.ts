import type { Page, Request } from '@playwright/test';
import type { Company } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { chartReads } from './chart-mocks';
import { company, owner } from './company-mocks';
import { type ApiReply, expect, fieldError, test } from './test';

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

test.use({ me: owner, api: chartReads });

test.describe("the payments' tolerance", () => {
  test('the owner saves it per invoice currency', async ({ page }) => {
    const saved = await answer(page, 'PATCH', '/company', (request) => ({
      status: 200,
      json: { ...company, ...(request.postDataJSON() as Partial<Company>) },
    }));
    await page.goto('/settings/company');
    const t = ar.company.settings.tolerance;
    const usd = page.getByLabel(t.usd);
    await expect(usd).toHaveValue('1.00');
    await usd.fill('2.5');
    await usd.press('Tab');
    await page.getByRole('button', { name: t.submit }).click();
    await expect(page.getByText(t.saved)).toBeVisible();
    expect(saved[0]?.postDataJSON()).toEqual({
      paymentToleranceSyp: '100',
      paymentToleranceUsd: '250',
    });
  });

  test('refuses text that is not an amount', async ({ page }) => {
    const saved = await answer(page, 'PATCH', '/company', { status: 200, json: company });
    await page.goto('/settings/company');
    const t = ar.company.settings.tolerance;
    const syp = page.getByLabel(t.syp);
    await syp.fill('-1');
    await syp.press('Tab');
    await page.getByRole('button', { name: t.submit }).click();
    await expect(fieldError(page, ar.accounting.amountInput.NEGATIVE_NOT_ALLOWED)).toBeVisible();
    expect(saved).toHaveLength(0);
  });
});
