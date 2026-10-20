import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Locally the database URLs come from the repository's git-ignored .env; variables already set
// (CI, a one-off run) take precedence.
const env = new URL('../../.env', import.meta.url);
if (existsSync(env)) process.loadEnvFile(env);

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    // The files share the run's database, and the convention test alters the fixture tables inside
    // transactions it rolls back: one file at a time, so its locks never meet another file's.
    fileParallelism: false,
  },
});
