import { defineConfig } from '@playwright/test';

/**
 * The worker's Chromium checks (S09 rules 27, 36): the print layout rendered by the built worker's
 * printer, run where Chromium is (Playwright's image in CI, `pnpm verify apps/worker/e2e/...`
 * locally); no server, no database. `pnpm test` runs the jobs with a stand-in printer.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 120_000,
  projects: [{ name: 'chromium' }],
});
