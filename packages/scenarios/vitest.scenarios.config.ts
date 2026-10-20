import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Locally the database URLs come from the repository's git-ignored .env; variables already set
// (CI, a one-off run) take precedence.
const env = new URL('../../.env', import.meta.url);
if (existsSync(env)) process.loadEnvFile(env);

// The scenario book (`pnpm test:scenarios`): every case of docs/scenarios on a fresh database for
// the run. The verbose reporter names each case, so the skipped `Proposed` ones are listed too.
export default defineConfig({
  test: {
    include: ['test/scenario-book.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    reporters: ['verbose'],
    testTimeout: 60_000,
  },
});
