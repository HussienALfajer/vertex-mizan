import type { TableInfo } from '../../src/index.js';

/** The registry entries of the fixture tables (`schema.ts`), checked with the real registry. */
export const fixtureRegistry = {
  fixture_documents: { module: 'fixtures', scope: 'company', kind: 'business' },
  fixture_entries: { module: 'fixtures', scope: 'company', kind: 'append-only' },
  fixture_lines: { module: 'fixtures', scope: 'company', kind: 'append-only' },
  fixture_settings: { module: 'fixtures', scope: 'platform', kind: 'business' },
} as const satisfies Record<string, TableInfo>;
