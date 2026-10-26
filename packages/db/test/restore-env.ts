import { afterAll } from 'vitest';

// The worker runs one file after another without isolation (vitest.config.ts): what a file sets in
// process.env is put back after it, so it never reaches the next file.
const environment = { ...process.env };
afterAll(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in environment)) delete process.env[key];
  }
  Object.assign(process.env, environment);
});
