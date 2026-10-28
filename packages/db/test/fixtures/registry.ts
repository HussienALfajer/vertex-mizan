import type { TableInfo } from '../../src/index.js';
import { type Guards, OWNER_ROLE } from '../conventions.js';

/** The registry entries of the fixture tables (`schema.ts`), checked with the real registry. */
export const fixtureRegistry = {
  fixture_documents: { module: 'fixtures', scope: 'company', kind: 'business' },
  fixture_entries: { module: 'fixtures', scope: 'company', kind: 'append-only' },
  fixture_lines: { module: 'fixtures', scope: 'company', kind: 'append-only' },
  fixture_counters: { module: 'fixtures', scope: 'company', kind: 'ledger-state' },
  fixture_settings: { module: 'fixtures', scope: 'platform', kind: 'business' },
  fixture_tokens: { module: 'fixtures', scope: 'platform', kind: 'ephemeral' },
} as const satisfies Record<string, TableInfo>;

/**
 * The guards of the fixture tables (`guards.sql`): the deferred balance of the entries and the
 * counter's rule, pinned and required like real ones.
 */
export const fixtureGuards: Guards = {
  functions: [
    {
      name: 'fixture_entry_balances',
      arguments: '',
      returns: 'trigger',
      language: 'plpgsql',
      volatility: 'v',
      parallel: 'u',
      strict: false,
      leakproof: false,
      definer: false,
      config: null,
      owner: OWNER_ROLE,
      source: `
DECLARE
  entry uuid;
  expected integer;
  line_count bigint;
  total numeric;
BEGIN
  IF TG_TABLE_NAME = 'fixture_entries' THEN
    entry := NEW.id;
  ELSE
    entry := NEW.entry_id;
  END IF;
  SELECT e.line_count INTO expected
  FROM public.fixture_entries e
  WHERE e.company_id = NEW.company_id AND e.id = entry;
  SELECT count(*), coalesce(sum(l.amount_minor), 0) INTO line_count, total
  FROM public.fixture_lines l
  WHERE l.company_id = NEW.company_id AND l.entry_id = entry;
  IF expected IS NULL OR line_count < 2 OR line_count <> expected OR total <> 0 THEN
    RAISE EXCEPTION 'fixture entry does not balance: % lines of %, total %',
      line_count, expected, total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
`,
    },
    {
      name: 'fixture_counter_rules',
      arguments: '',
      returns: 'trigger',
      language: 'plpgsql',
      volatility: 'v',
      parallel: 'u',
      strict: false,
      leakproof: false,
      definer: false,
      config: null,
      owner: OWNER_ROLE,
      source: `
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.last_number <> 1)
    OR (TG_OP = 'UPDATE' AND NEW.last_number IS DISTINCT FROM OLD.last_number + 1) THEN
    RAISE EXCEPTION 'fixture counter moves by one' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
`,
    },
  ],
  triggers: [
    {
      table: 'fixture_entries',
      name: 'fixture_entries_balance',
      function: 'fixture_entry_balances',
      deferred: true,
      on: ['INSERT'],
    },
    {
      table: 'fixture_lines',
      name: 'fixture_lines_balance',
      function: 'fixture_entry_balances',
      deferred: true,
      on: ['INSERT'],
    },
    {
      table: 'fixture_counters',
      name: 'fixture_counter_rules',
      function: 'fixture_counter_rules',
      deferred: false,
      on: ['INSERT', 'UPDATE'],
    },
  ],
};
