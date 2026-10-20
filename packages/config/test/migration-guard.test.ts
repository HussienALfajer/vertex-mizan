import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The migration guard `scripts/migration-guard.mjs` (ADR 0008), run as CI runs it, on throwaway
// SQL files.
const script = fileURLToPath(new URL('../../../scripts/migration-guard.mjs', import.meta.url));

let dir = '';
let count = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'migration-guard-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Runs the guard on one SQL file; returns the refused rules and the exit code. */
function guard(sql: string): { status: number | null; rules: string[]; output: string } {
  const file = join(dir, `${String(count++).padStart(4, '0')}_test.sql`);
  writeFileSync(file, sql);
  const result = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
  const rules = [...result.stderr.matchAll(/^\S+:\d+ {2}([a-z-]+) {2}/gm)].map((m) => m[1] ?? '');
  return { status: result.status, rules, output: result.stdout + result.stderr };
}

describe('migration guard: refuses guard-weakening SQL', () => {
  it.each([
    [
      'ALTER TABLE journal_entries DISABLE TRIGGER journal_entries_refuse_change;',
      'disable-trigger',
    ],
    ['alter table journal_lines disable trigger all;', 'disable-trigger'],
    ['ALTER TABLE journal_lines ENABLE TRIGGER journal_lines_refuse_change;', 'enable-trigger'],
    ['ALTER TABLE journal_lines ENABLE REPLICA TRIGGER t;', 'enable-trigger'],
    ['DROP TRIGGER journal_lines_refuse_change ON journal_lines;', 'drop-trigger'],
    ['DROP POLICY company_isolation ON accounts;', 'drop-policy'],
    ['ALTER POLICY company_isolation ON accounts USING (true);', 'alter-policy'],
    ['DROP FUNCTION refuse_change() CASCADE;', 'drop-cascade'],
    ['ALTER TABLE accounts NO FORCE ROW LEVEL SECURITY;', 'no-force-rls'],
    ['ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;', 'disable-rls'],
    ['ALTER TABLE accounts OWNER TO mizan_app;', 'alter-owner'],
    ['REASSIGN OWNED BY mizan_owner TO mizan_app;', 'alter-owner'],
    ["SET session_replication_role = 'replica';", 'replication-role'],
    ['ALTER ROLE mizan_app BYPASSRLS;', 'bypass-rls'],
    [
      'CREATE FUNCTION f() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;',
      'security-definer',
    ],
  ])('%s → %s', (sql, rule) => {
    const result = guard(sql);
    expect(result.status).toBe(1);
    expect(result.rules).toEqual([rule]);
  });

  it('catches dynamic SQL inside a function body and a DO block', () => {
    const result = guard(`
      DO $$
      BEGIN
        EXECUTE format('ALTER TABLE %I DISABLE TRIGGER ALL', 'journal_lines');
      END
      $$;
      CREATE FUNCTION weaken() RETURNS void LANGUAGE plpgsql AS $body$
      BEGIN
        PERFORM set_config('session_replication_role', 'replica', true);
      END
      $body$;
    `);
    expect(result.rules).toEqual(['disable-trigger', 'replication-role']);
  });

  it('reports the line of the offending statement', () => {
    const result = guard('CREATE TABLE t (id int);\n\n\nDROP POLICY p ON t;\n');
    expect(result.output).toMatch(/_test\.sql:4 {2}drop-policy/);
  });
});

describe('migration guard: allows the guards themselves', () => {
  it('passes what a ledger migration creates', () => {
    const result = guard(`
      -- Comments may say DISABLE TRIGGER or DROP POLICY: they are ignored.
      /* So may block comments: NO FORCE ROW LEVEL SECURITY. */
      CREATE FUNCTION refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        -- a comment inside the body: DROP TRIGGER
        RAISE EXCEPTION 'ledger rows are append-only' USING ERRCODE = 'restrict_violation';
      END
      $$;
      --> statement-breakpoint
      CREATE TRIGGER journal_lines_refuse_change BEFORE UPDATE OR DELETE ON journal_lines
        FOR EACH ROW EXECUTE FUNCTION refuse_change();
      ALTER TABLE journal_lines ENABLE ALWAYS TRIGGER journal_lines_refuse_change;
      ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
      ALTER TABLE journal_lines FORCE ROW LEVEL SECURITY;
      CREATE POLICY company_isolation ON journal_lines
        USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());
      REVOKE ALL ON journal_lines FROM PUBLIC;
      GRANT SELECT, INSERT ON journal_lines TO mizan_app;
      ALTER ROLE mizan_app NOBYPASSRLS;
      CREATE TABLE "weird ""name""" (id int);
      SELECT $1, 'it''s fine';
    `);
    expect(result.output).toContain('nothing weakens a guard');
    expect(result.status).toBe(0);
  });

  it('passes when there are no migrations yet', () => {
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    const result = spawnSync(process.execPath, [script, empty], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('0 file(s) checked');
  });
});

describe('migration guard: exceptions need an ADR', () => {
  it('allows the named rule in the statement that carries the marker', () => {
    const result = guard(`
      -- migration-guard: allow drop-policy (ADR 0008)
      DROP POLICY company_isolation ON accounts;
    `);
    expect(result.status).toBe(0);
  });

  it('allows only the named rule, and only in that statement', () => {
    const result = guard(`
      -- migration-guard: allow drop-policy (ADR 0008)
      DROP POLICY a ON accounts;
      DROP POLICY b ON accounts;
      -- migration-guard: allow drop-trigger (ADR 0008)
      ALTER TABLE accounts NO FORCE ROW LEVEL SECURITY;
    `);
    expect(result.rules).toEqual(['drop-policy', 'no-force-rls']);
  });

  it('refuses a marker that names an ADR that does not exist', () => {
    const result = guard(`
      -- migration-guard: allow drop-policy (ADR 9999)
      DROP POLICY company_isolation ON accounts;
    `);
    expect(result.rules).toEqual(['unknown-adr', 'drop-policy']);
  });
});
