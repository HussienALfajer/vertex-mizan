import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  // Every test mocks the API for its own page (`e2e/test.ts`), so tests run in any order. Running
  // them in parallel lets CI's `--shard` split by test rather than by file.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry keeps a runner hiccup from failing CI, but a test that only passes on retry fails
  // the run: flaky tests hide real intermittent bugs.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    locale: 'ar-SY',
    timezoneId: 'Asia/Damascus',
    // A trace for every test made Hub's suite 30% slower and kept the antivirus scanning each
    // trace file. CI records the retry of a failed test; locally pass `--trace on` to debug.
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Serves the production build: `pnpm verify` and CI build it first.
  webServer: {
    command: 'pnpm preview',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
