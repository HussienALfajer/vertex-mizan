import { defineConfig } from 'vitest/config';

// The runner's own tests: the format, the comparison and the run against a fake harness. No
// database; the book itself runs with `vitest.scenarios.config.ts`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
