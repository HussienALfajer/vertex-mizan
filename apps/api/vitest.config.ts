import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Locally the database URLs come from the repository's git-ignored .env; variables already set
// (CI, a one-off run) take precedence.
const env = new URL('../../.env', import.meta.url);
if (existsSync(env)) process.loadEnvFile(env);

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    // A signed-in, enrolled person takes several requests and Argon2id hashes (S01), and a test
    // that types more than three codes of one authenticator waits for the next 30-second TOTP step
    // (`freshCode()` in test/people.ts): up to 30 s more, wherever in the step the test started.
    testTimeout: 65_000,
  },
});
