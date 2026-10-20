import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The migration guard `scripts/migration-guard.mjs` (ADR 0008), run as CI runs it, on throwaway
// SQL files, with fixture ADRs for the exceptions and fixture `packages/db` folders for the table
// registry and the layout of the migrations.
const script = fileURLToPath(new URL('../../../scripts/migration-guard.mjs', import.meta.url));

// A registry in TypeScript, as `packages/db/src/schema/registry.ts` is: the guard loads it with
// Node's type stripping.
const REGISTRY = `type TableInfo = { module: string; scope: 'company' | 'platform'; kind: string };

export const tableRegistry = {
  accounts: { module: 'accounts', scope: 'company', kind: 'business' },
  journal_entries: { module: 'ledger', scope: 'company', kind: 'append-only' },
  journal_lines: { module: 'ledger', scope: 'company', kind: 'append-only' },
} as const satisfies Record<string, TableInfo>;
`;

let dir = '';
let decisions = '';
let ledger = '';
let count = 0;

/** A fixture `packages/db`: its registry, and its migrations as `{ path: sql }`. */
function dbFolder(name: string, { registry = true, migrations = {} as Record<string, string> }) {
  const db = join(dir, name);
  mkdirSync(db);
  if (registry) {
    mkdirSync(join(db, 'src', 'schema'), { recursive: true });
    writeFileSync(join(db, 'src', 'schema', 'registry.ts'), REGISTRY);
  }
  for (const [path, sql] of Object.entries(migrations)) {
    const file = join(db, 'migrations', path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, sql);
  }
  return db;
}

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
  adr('0103-backfill.md', 'Accepted', 'Allows `migration-guard: allow append-only-write` once.');
  ledger = dbFolder('ledger-db', {});
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

type Result = { status: number | null; rules: string[]; output: string };

/** Runs the guard with `args`; returns the refused rules (with or without a line) and the exit code. */
function run(args: string[]): Result {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const rules = [...result.stderr.matchAll(/^\S+? {2}([a-z-]+) {2}/gm)].map((m) => m[1] ?? '');
  return { status: result.status, rules, output: result.stdout + result.stderr };
}

/** Runs the guard on one SQL file, with the fixture ledger registry unless `db` says otherwise. */
function guard(sql: string, { realDecisions = false, db = ledger } = {}): Result {
  const file = join(dir, `${String(count++).padStart(4, '0')}_test.sql`);
  writeFileSync(file, sql);
  return run(realDecisions ? ['--db', db, file] : ['--decisions', decisions, '--db', db, file]);
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
    [
      `CREATE OR REPLACE TRIGGER accounts_refuse_change BEFORE UPDATE ON accounts
         FOR EACH ROW WHEN (false) EXECUTE FUNCTION refuse_change();`,
      'replace-trigger',
    ],
    ['CREATE RULE skip AS ON UPDATE TO accounts DO INSTEAD NOTHING;', 'create-rule'],
    [
      'CREATE OR REPLACE RULE copy AS ON INSERT TO accounts DO ALSO NOTIFY accounts;',
      'create-rule',
    ],
    ['DROP OWNED BY mizan_owner;', 'drop-owned'],
    ["ALTER TYPE rate_type RENAME VALUE 'market' TO 'bulletin';", 'rename-enum-value'],
    ["alter type public.rate_type\n  rename value 'bulletin' to 'market';", 'rename-enum-value'],
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

  it('passes a folder given as an argument with no migration in it', () => {
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    const result = run(['--db', ledger, empty]);
    expect(result.status).toBe(0);
    expect(result.output).toContain('0 file(s) checked');
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

describe('migration guard: append-only tables of the registry', () => {
  it.each([
    'UPDATE journal_lines SET amount_minor = 0;',
    'update public.journal_lines set memo = null where true;',
    'UPDATE ONLY "journal_lines" AS l SET memo = null;',
    'WITH moved AS (UPDATE journal_entries SET memo = null RETURNING id) SELECT * FROM moved;',
    'DELETE FROM journal_lines WHERE amount_minor = 0;',
    'delete from only public."journal_entries";',
    'TRUNCATE journal_lines;',
    'TRUNCATE TABLE accounts, ONLY journal_entries RESTART IDENTITY;',
    'MERGE INTO journal_lines l USING accounts a ON false WHEN NOT MATCHED THEN DO NOTHING;',
    `INSERT INTO journal_lines (id, memo) VALUES ($1, 'x')
       ON CONFLICT (id) DO UPDATE SET memo = excluded.memo;`,
    "DO $$ BEGIN EXECUTE 'DELETE FROM journal_lines'; END $$;",
  ])('refuses a change of its rows: %s', (sql) => {
    const result = guard(sql);
    expect(result.rules).toEqual(['append-only-write']);
    expect(result.status).toBe(1);
  });

  it.each([
    'DROP TABLE journal_lines;',
    'DROP TABLE IF EXISTS accounts, public.journal_entries;',
    'ALTER TABLE journal_lines DROP COLUMN memo;',
    'ALTER TABLE IF EXISTS journal_lines DROP memo, ADD COLUMN note text;',
    'ALTER TABLE ONLY journal_lines ALTER COLUMN amount_minor TYPE numeric USING amount_minor * 2;',
    'ALTER TABLE journal_lines ALTER amount_minor SET DATA TYPE integer;',
    'ALTER TABLE journal_lines RENAME TO journal_lines_old;',
    'ALTER TABLE journal_lines RENAME COLUMN book_amount_minor TO parallel_amount_minor;',
    'ALTER TABLE journal_lines RENAME memo TO note;',
    'ALTER TABLE journal_lines SET SCHEMA archive;',
    'ALTER TABLE journal_lines ALTER COLUMN total_minor SET EXPRESSION AS (amount_minor * 2);',
    `ALTER TABLE journal_lines
       ADD COLUMN doubled_minor bigint GENERATED ALWAYS AS (amount_minor * 2) STORED;`,
    'ALTER TABLE journal_lines ATTACH PARTITION journal_lines_2026 FOR VALUES IN (2026);',
    'ALTER TABLE ledger_all ATTACH PARTITION journal_lines DEFAULT;',
    'ALTER TABLE ledger_all DETACH PARTITION journal_entries;',
    'ALTER TABLE journal_lines_extra INHERIT journal_lines;',
    'CREATE TABLE journal_lines_extra (memo text) INHERITS (accounts, journal_lines);',
    'CREATE TABLE journal_lines_2027 PARTITION OF journal_lines FOR VALUES IN (2027);',
  ])('refuses dropping or rewriting what it stores: %s', (sql) => {
    const result = guard(sql);
    expect(result.rules).toEqual(['append-only-rewrite']);
    expect(result.status).toBe(1);
  });

  it('passes the same statements on a business table, and what a ledger migration writes', () => {
    const result = guard(`
      UPDATE accounts SET name = 'x';
      DELETE FROM accounts WHERE false;
      TRUNCATE accounts;
      ALTER TABLE accounts DROP COLUMN memo, ALTER COLUMN code TYPE text;
      DROP TABLE accounts;
      UPDATE journal_lines_archive SET memo = null;
      CREATE TRIGGER journal_lines_refuse_change BEFORE UPDATE OR DELETE ON journal_lines
        FOR EACH ROW EXECUTE FUNCTION refuse_change();
      CREATE TRIGGER journal_lines_refuse_truncate BEFORE TRUNCATE ON journal_lines
        FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
      ALTER TABLE journal_lines ENABLE ALWAYS TRIGGER journal_lines_refuse_change;
      GRANT SELECT, INSERT ON journal_lines TO mizan_app;
      ALTER TABLE journal_lines ADD COLUMN memo text, ALTER COLUMN memo SET DEFAULT '';
      ALTER TABLE journal_lines ALTER COLUMN memo DROP DEFAULT, ALTER COLUMN memo DROP NOT NULL;
      ALTER TABLE journal_lines DROP CONSTRAINT journal_lines_memo_check;
      ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_entry_fk FOREIGN KEY (company_id, entry_id)
        REFERENCES journal_entries (company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT;
      INSERT INTO journal_lines (id) VALUES ($1) ON CONFLICT DO NOTHING;
      SELECT id FROM journal_entries FOR UPDATE OF journal_entries;
    `);
    expect(result.output).toContain('nothing weakens a guard');
    expect(result.status).toBe(0);
  });

  it('reads each command of a body on its own, so a later upsert or ALTER is not blamed on it', () => {
    const result = guard(`
      CREATE FUNCTION post() RETURNS void LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO journal_lines (id) VALUES (gen_random_uuid());
        INSERT INTO period_balances (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET id = 1;
        EXECUTE 'ALTER TABLE journal_lines ENABLE ALWAYS TRIGGER t';
        EXECUTE 'ALTER TABLE accounts DROP COLUMN memo';
      END
      $$;
    `);
    expect(result.output).toContain('nothing weakens a guard');
    expect(result.status).toBe(0);
  });

  it('allows a change only with an accepted ADR that names the rule', () => {
    expect(
      guard(
        '-- migration-guard: allow append-only-write (ADR 0103)\nUPDATE journal_lines SET memo = null;',
      ).status,
    ).toBe(0);
    expect(
      guard(
        '-- migration-guard: allow append-only-write (ADR 0100)\nUPDATE journal_lines SET memo = null;',
      ).rules,
    ).toEqual(['exception-refused', 'append-only-write']);
  });

  it('reads the registry of packages/db by default, where nothing is append-only before S03', () => {
    const file = join(dir, 'real-registry.sql');
    writeFileSync(file, 'UPDATE journal_lines SET memo = null;');
    expect(run(['--decisions', decisions, file]).status).toBe(0);
  });
});

describe('migration guard: the migrations of packages/db', () => {
  const CLEAN = 'CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;';

  it('checks every top-level migration, beside drizzle-kit’s meta folder', () => {
    const db = dbFolder('layout-ok', {
      migrations: { '0000_a.sql': CLEAN, '0001_b.sql': CLEAN, 'meta/_journal.json': '{}' },
    });
    const result = run(['--db', db]);
    expect(result.output).toContain('2 file(s) checked');
    expect(result.status).toBe(0);
  });

  it('refuses the folder’s statements against its own registry', () => {
    const db = dbFolder('layout-update', {
      migrations: { '0000_a.sql': 'DELETE FROM journal_entries;' },
    });
    expect(run(['--db', db]).rules).toEqual(['append-only-write']);
  });

  it('fails when packages/db has no migration', () => {
    const empty = dbFolder('layout-empty', { migrations: { 'meta/_journal.json': '{}' } });
    const none = dbFolder('layout-none', {});
    for (const db of [empty, none]) {
      const result = run(['--db', db]);
      expect(result.rules).toEqual(['no-migrations']);
      expect(result.status).toBe(1);
    }
  });

  it('fails on a migration in a subfolder, which it would not read', () => {
    const db = dbFolder('layout-nested', {
      migrations: { '0000_a.sql': CLEAN, '20261020_b/migration.sql': 'DROP POLICY p ON t;' },
    });
    const result = run(['--db', db]);
    expect(result.rules).toEqual(['nested-migration']);
    expect(result.output).toMatch(/20261020_b\/migration\.sql {2}nested-migration/);
    expect(result.status).toBe(1);
  });

  it('fails when packages/db has no table registry', () => {
    const db = dbFolder('layout-unregistered', {
      registry: false,
      migrations: { '0000_a.sql': CLEAN },
    });
    const result = run(['--db', db]);
    expect(result.rules).toEqual(['no-registry']);
    expect(result.status).toBe(1);
  });

  it('has nothing to check before packages/db exists', () => {
    const result = run(['--db', join(dir, 'no-such-package')]);
    expect(result.output).toContain('0 file(s) checked');
    expect(result.status).toBe(0);
  });
});
