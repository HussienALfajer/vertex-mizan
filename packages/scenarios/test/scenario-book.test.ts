import { fileURLToPath } from 'node:url';
import { createDatabase } from '@vertex-mizan/db';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { readBook } from '../src/book.js';
import { bookHarness, type ScenarioDatabase } from '../src/harness.js';
import { runCase } from '../src/run.js';

// The scenario book (ADR 0005, ADR 0008): every Approved case runs on the run's fresh database
// through the harness; every Proposed case is skipped, never counted as passing, and listed by the
// verbose reporter as "Proposed: <case>" with the run's skipped count in its summary.
const book = readBook(fileURLToPath(new URL('../../../', import.meta.url)));

const database: ScenarioDatabase = {
  app: createDatabase(inject('appUrl')),
  jobs: createDatabase(inject('jobsUrl')),
};

afterAll(async () => {
  await Promise.all([database.app.$client.end(), database.jobs.$client.end()]);
});

it('every scenario file is in the format of docs/scenarios/README.md', () => {
  expect(book.errors).toEqual([]);
});

for (const file of book.files) {
  describe(file.path, () => {
    for (const scenarioCase of file.cases) {
      if (file.status.status === 'proposed') {
        it.skip(`Proposed: ${scenarioCase.name}`, () => {});
      } else {
        it(scenarioCase.name, () => runCase(scenarioCase, bookHarness, database));
      }
    }
  });
}
