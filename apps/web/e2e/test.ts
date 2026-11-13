import {
  test as base,
  expect,
  type Locator,
  type Page,
  type Request,
  type TestInfo,
} from '@playwright/test';
import type { Company, ErrorCode, HealthResponse, Me } from '@vertex-mizan/contracts';

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

/** A synthetic person with two-factor enrolled, owner of one synthetic company. */
export const signedIn: Me = {
  person: {
    id: '01900000-0000-7000-8000-000000000001',
    name: 'مستخدم تجريبي',
    email: 'owner@example.test',
    twoFactorEnabled: true,
  },
  memberships: [
    {
      membershipId: '01900000-0000-7000-8000-000000000002',
      company: {
        id: '01900000-0000-7000-8000-000000000003',
        name: 'شركة اختبار',
        nameLatin: 'Test Company',
        archived: false,
      },
      role: 'owner',
      canClosePeriods: true,
    },
  ],
  activeCompanyId: '01900000-0000-7000-8000-000000000003',
  permissions: ['company.read'],
};

/**
 * The active company as `GET /api/company` answers it: the shell reads it for the opening's link
 * (S10), so every page asks for it; a company without a books start unless a test says so.
 */
export const defaultCompany: Company = {
  id: '01900000-0000-7000-8000-000000000003',
  name: 'شركة اختبار',
  nameLatin: 'Test Company',
  ledgers: {
    book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
    parallel: {
      currency: 'USD',
      ratePolicy: { rateType: 'market', acceptsTransactionRate: true },
    },
  },
  fiscalYearStartMonth: 1,
  policyNote: 'العملة الوظيفية هي الليرة السورية: عملة البيئة الاقتصادية الرئيسية للشركة (مثال).',
  booksStarted: false,
  booksStart: null,
  openingState: null,
  manualEntryApproval: false,
  paymentToleranceSyp: '100',
  paymentToleranceUsd: '100',
  archived: null,
  createdAt: '2026-10-20T08:00:00.000Z',
};

/** An API answer: a status and a JSON body (none for 204). */
export interface ApiReply {
  status: number;
  json?: unknown;
}

/** Answers keyed by `METHOD /api/path` (no query string); a function sees the request. */
export type ApiMocks = Record<string, ApiReply | ((request: Request) => ApiReply)>;

/** The API's refusal with a stable code, as `errorResponseSchema` describes it. */
/** A field's error beside it: a refused form's error summary repeats it above the form. */
export function fieldError(scope: Page | Locator, text: string): Locator {
  return scope.locator('[data-slot="field-error"]').filter({ hasText: text });
}

export function refusal(status: number, code: ErrorCode): ApiReply {
  return { status, json: { statusCode: status, code, message: code } };
}

export const test = base.extend<{ health: HealthMock; me: Me | null; api: ApiMocks }>({
  health: [healthy, { option: true }],
  // `GET /api/me`: the person, or `null` for no session (401). An `api` mock of it wins.
  me: [signedIn, { option: true }],
  api: [{}, { option: true }],
  page: async ({ page, health, me, api }, use) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(`Page error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().startsWith('Base UI')) {
        failures.push(`Console: ${message.text()}`);
      }
    });
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const key = `${route.request().method()} ${url.pathname}`;
      const mock = api[key];
      if (mock) {
        const reply = typeof mock === 'function' ? mock(route.request()) : mock;
        return reply.json === undefined
          ? route.fulfill({ status: reply.status })
          : route.fulfill({ status: reply.status, json: reply.json });
      }
      if (key === 'GET /api/me') {
        const reply = me ? { status: 200, json: me } : refusal(401, 'UNAUTHENTICATED');
        return route.fulfill({ status: reply.status, json: reply.json });
      }
      // The shell's held count beside the inbox's link (S05): none held unless a test says so.
      if (key === 'GET /api/inbox/counts') {
        return route.fulfill({ status: 200, json: { held: 0, reasons: [] } });
      }
      // The shell's unclean reconciliation days (S08): none unless a test says so.
      if (key === 'GET /api/reconciliation/counts') {
        return route.fulfill({ status: 200, json: { uncleanDays: 0 } });
      }
      if (key === 'GET /api/company') {
        return route.fulfill({ status: 200, json: defaultCompany });
      }
      if (key === 'GET /api/health') {
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

/**
 * Attaches a screenshot after the fonts load: the design review evidence. The whole page, or only
 * the viewport (`fullPage: false`) while a fixed overlay (a dialog, a sheet) is open. The whole
 * page is taken by growing the viewport to the page's height, as Vertex Hub does: Playwright's
 * `fullPage` capture of a tall page intermittently fails in Chromium ("Unable to capture
 * screenshot").
 */
export async function screenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
  { fullPage = true }: { fullPage?: boolean } = {},
): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const path = testInfo.outputPath(`${name}.png`);
  const viewport = page.viewportSize();
  if (fullPage && viewport) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({
      width: viewport.width,
      height: Math.max(height, viewport.height),
    });
  }
  await page.screenshot({ path, animations: 'disabled' });
  if (fullPage && viewport) await page.setViewportSize(viewport);
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
