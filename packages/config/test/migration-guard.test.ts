import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The migration guard `scripts/migration-guard.mjs` (ADR 0008), run as CI runs it, on throwaway
// SQL files, with fixture ADRs for the exceptions.
const script = fileURLToPath(new URL('../../../scripts/migration-guard.mjs', import.meta.url));

let dir = '';
let decisions = '';
let count = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'migration-guard-'));
  decisions = join(dir, 'decisions');
  mkdirSync(decisions);
  const adr = (file: string, status: string, body: string) =>
    writeFileSync(
      join(decisions, file),
      `# ${file}\n\nStatus: ${status} · Date: 2026-10-20\n\n${body}\n`,
    );
  adr('0100-replace-policy.md', 'Accepted', 'Allows `migration-guard: allow drop-policy` once.');
  adr('0101-proposed.md', 'Proposed', 'Would allow `migration-guard: allow drop-policy`.');
  adr('0102-other.md', 'Accepted', 'Says nothing about the migration guard.');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Runs the guard on one SQL file; returns the refused rules and the exit code. */
function guard(
  sql: string,
  { realDecisions = false } = {},
): { status: number | null; rules: string[]; output: string } {
  const file = join(dir, `${String(count++).padStart(4, '0')}_test.sql`);
  writeFileSync(file, sql);
  const args = realDecisions ? [script, file] : [script, '--decisions', decisions, file];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
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
    ['SET standard_conforming_strings = off;', 'string-escaping'],
    ["SET backslash_quote = 'on';", 'string-escaping'],
    ['ALTER ROLE mizan_app BYPASSRLS;', 'bypass-rls'],
    [
      'CREATE FUNCTION f() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;',
      'security-definer',
    ],
    ['GRANT ALL ON accounts TO mizan_app;', 'grant-forbidden'],
    ['GRANT SELECT, TRUNCATE ON journal_lines TO mizan_app;', 'grant-forbidden'],
    ['GRANT REFERENCES (id) ON accounts TO mizan_app;', 'grant-forbidden'],
    [
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO mizan_app;',
      'grant-forbidden',
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

  it('ends a dollar-quoted body at its tag, so nothing inside hides what follows', () => {
    // A `--` inside the body would otherwise blank the closing tag and the next statement.
    expect(
      guard('DO $$ BEGIN NULL; END -- $$; DROP POLICY company_isolation ON journal_lines;').rules,
    ).toEqual(['drop-policy']);
    // An apostrophe inside the body would otherwise open a string that swallows the attack.
    expect(
      guard(
        "COMMENT ON TABLE t IS $$it's$$; SELECT ' -- '; ALTER TABLE journal_lines DISABLE TRIGGER ALL;",
      ).rules,
    ).toEqual(['disable-trigger']);
  });

  it('reads backslash escapes in E strings as PostgreSQL does', () => {
    // In E'…' the backslash escapes the quote, so ` -- ` is inside the string, not a comment.
    expect(guard("SELECT E'\\' -- '; DROP POLICY company_isolation ON accounts;").rules).toEqual([
      'drop-policy',
    ]);
    // Escapes that are not code points are fine.
    expect(guard("SELECT E'it\\'s\\tfine';").status).toBe(0);
  });

  it('reads `$` and non-ASCII letters as part of a name, as PostgreSQL does', () => {
    // `x$$$` and `é$$` are names, not the start of a dollar-quoted body.
    expect(
      guard('SELECT 1 AS x$$$; SELECT $$ -- $$; DROP POLICY company_isolation ON t;').rules,
    ).toEqual(['drop-policy']);
    expect(guard('SELECT 1 AS é$$; SELECT $$ -- $$; DROP POLICY p ON t;').rules).toEqual([
      'drop-policy',
    ]);
    // `a$e'…'` is the name `a$e` and a plain string, not an E string.
    expect(guard("SELECT a$e'\\'; SELECT ' -- '; DROP POLICY p ON t;").rules).toEqual([
      'drop-policy',
    ]);
  });

  it.each([
    'SET U&"standard\\005fconforming_strings" = off;',
    'SET U&"session\\005freplication_role" = replica;',
    "DO $$ BEGIN EXECUTE E'DROP \\x50OLICY p ON t'; END $$;",
    "SELECT E'\\120';",
  ])('refuses an escaped literal that could spell a forbidden word: %s', (sql) => {
    expect(guard(sql).rules).toEqual(['escaped-literal']);
  });

  it('refuses turning standard_conforming_strings off before a string that would hide SQL', () => {
    const result = guard(
      "SET standard_conforming_strings = off; SELECT '\\' -- '; DROP POLICY company_isolation ON accounts;",
    );
    expect(result.rules).toContain('string-escaping');
    expect(result.status).toBe(1);
  });

  it('checks comments inside a body as text: a false positive is safer than a miss', () => {
    const result = guard(`
      CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$
      BEGIN
        -- never DROP TRIGGER here
      END
      $$;
    `);
    expect(result.rules).toEqual(['drop-trigger']);
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
      GRANT UPDATE (status) ON event_inbox TO mizan_app;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO mizan_jobs;
      GRANT USAGE ON SCHEMA public TO mizan_app;
      ALTER ROLE mizan_app NOBYPASSRLS;
      COMMENT ON TABLE journal_lines IS $$the company's journal lines$$;
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

describe('migration guard: exceptions need an accepted ADR that allows the rule', () => {
  it('allows the named rule in the statement that carries the marker', () => {
    const result = guard(`
      -- migration-guard: allow drop-policy (ADR 0100)
      DROP POLICY company_isolation ON accounts;
    `);
    expect(result.status).toBe(0);
  });

  it('allows only the named rule, and only in that statement', () => {
    const result = guard(`
      -- migration-guard: allow drop-policy (ADR 0100)
      DROP POLICY a ON accounts;
      DROP POLICY b ON accounts;
    `);
    expect(result.rules).toEqual(['drop-policy']);
  });

  it.each([
    ['an ADR that does not exist', 'drop-policy (ADR 9999)', 'DROP POLICY p ON t;'],
    ['an ADR that is not accepted', 'drop-policy (ADR 0101)', 'DROP POLICY p ON t;'],
    ['an ADR that does not allow the rule', 'drop-policy (ADR 0102)', 'DROP POLICY p ON t;'],
    [
      'a rule its ADR does not allow',
      'no-force-rls (ADR 0100)',
      'ALTER TABLE t NO FORCE ROW LEVEL SECURITY;',
    ],
  ])('refuses an exception that names %s', (_, marker, sql) => {
    const result = guard(`-- migration-guard: allow ${marker}\n${sql}`);
    expect(result.rules[0]).toBe('exception-refused');
    expect(result.rules).toHaveLength(2);
    expect(result.status).toBe(1);
  });

  it('cannot cite ADR 0008, which forbids these statements', () => {
    const result = guard('-- migration-guard: allow drop-policy (ADR 0008)\nDROP POLICY p ON t;', {
      realDecisions: true,
    });
    expect(result.rules).toEqual(['exception-refused', 'drop-policy']);
  });
});
