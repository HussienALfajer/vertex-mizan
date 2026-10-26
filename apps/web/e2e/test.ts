import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import type { HealthResponse } from '@vertex-mizan/contracts';

/*
 * The `test` every spec uses: Playwright's, with the API mocked for the page and failing a test
 * when the page breaks unseen (an uncaught error, Base UI reporting misuse) or asks the API for
 * something the mock does not answer.
 */

/** What `GET /api/health` answers: a status and body, or no answer at all (`unreachable`). */
export type HealthMock = { status: 200 | 503; body: HealthResponse } | 'unreachable';

export const healthy: HealthMock = {
  status: 200,
  body: { status: 'ok', checks: { database: 'up' }, timestamp: '2026-10-21T09:30:00.000Z' },
};

export const test = base.extend<{ health: HealthMock }>({
  health: [healthy, { option: true }],
  page: async ({ page, health }, use) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(`Page error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().startsWith('Base UI')) {
        failures.push(`Console: ${message.text()}`);
      }
    });
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'GET' && url.pathname === '/api/health') {
        if (health === 'unreachable') return route.abort('connectionrefused');
        return route.fulfill({ status: health.status, json: health.body });
      }
      failures.push(`Unmocked API request: ${route.request().method()} ${url.pathname}`);
      return route.abort();
    });
    await use(page);
    expect(failures).toEqual([]);
  },
});

/** The widths every screen is checked at (AGENTS.md: responsive from 360 px). */
export const widths = [360, 768, 1280] as const;

/** Attaches a screenshot of the whole page, after the fonts load: the design review evidence. */
export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

/** The page never scrolls sideways: wide content scrolls inside its own container. */
export async function expectNoPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

export { expect };
