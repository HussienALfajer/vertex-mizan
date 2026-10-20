import { describe, expect, inject, it } from 'vitest';
import { type TableInfo, tableRegistry } from '../src/index.js';
import { connect } from './connections.js';
import {
  checkConventions,
  GUARDS,
  type Guards,
  OWNER_ROLE,
  RULES,
  type Rule,
  type Violation,
} from './conventions.js';
import { fixtureGuards, fixtureRegistry } from './fixtures/registry.js';

// The conventions of ADR 0003, ADR 0005 and ADR 0008 (test/conventions.ts), read as the app role
// (ADR 0008). Each rule is then proven: a mutation breaks a fixture table, a function, a schema or
// a role inside a transaction that is rolled back, and the check must report that rule and no
// other. A mutation runs as the owner role, as a migration would, or as the superuser for what only
// a superuser can do (an owner or a role attribute).

const { app, superuser } = connect();
const database = inject('databaseName');
const registry: Record<string, TableInfo> = { ...tableRegistry, ...fixtureRegistry };
const guards: Guards = {
  functions: [...GUARDS.functions, ...fixtureGuards.functions],
  triggers: [...GUARDS.triggers, ...fixtureGuards.triggers],
};

type Mutation = {
  name: string;
  rules: Rule[];
  sql: string;
  as?: 'owner' | 'superuser';
  registry?: Record<string, TableInfo>;
};

const MUTATIONS: Mutation[] = [
  {
    name: 'a table missing from the registry',
    rules: ['registry'],
    sql: `create table fixture_unlisted (
            id uuid primary key
              constraint fixture_unlisted_id_is_uuidv7 check ((uuid_extract_version(id) = 7) is true),
            created_at timestamptz not null default now())`,
  },
  {
    name: 'a registered table that does not exist',
    rules: ['registry'],
    sql: '',
    registry: {
      ...registry,
      fixture_missing: { module: 'fixtures', scope: 'platform', kind: 'business' },
    },
  },
  {
    name: 'a view',
    rules: ['relation-kind'],
    sql: 'create view fixture_names as select name from fixture_settings',
  },
  {
    name: 'a materialized view, which has no RLS of its own',
    rules: ['relation-kind'],
    sql: `create materialized view fixture_totals as
            select company_id, sum(amount_minor) as total_minor from fixture_lines group by 1`,
  },
  {
    name: 'a rule that doubles every line as it is inserted',
    rules: ['rewrite-rule'],
    sql: `create rule fixture_double as on insert to fixture_lines do instead
            insert into fixture_lines (id, company_id, entry_id, amount_minor)
            values (new.id, new.company_id, new.entry_id, new.amount_minor * 2)`,
  },
  {
    name: 'a rule that turns an update into nothing',
    rules: ['rewrite-rule'],
    sql: 'create rule fixture_skip as on update to fixture_entries do instead nothing',
  },
  {
    name: 'a table that inherits from another, adding its rows to every read of the parent',
    rules: ['inheritance'],
    sql: `create table fixture_shadow (like fixture_settings including all)
            inherits (fixture_settings)`,
    registry: {
      ...registry,
      fixture_shadow: { module: 'fixtures', scope: 'platform', kind: 'business' },
    },
  },
  {
    name: 'a table hidden in the pg-boss schema',
    rules: ['table-schema'],
    sql: 'create table pgboss.fixture_hidden (id uuid)',
  },
  {
    name: 'a table hidden in the migration journal schema',
    rules: ['table-schema'],
    sql: 'create table drizzle.fixture_hidden (id uuid)',
  },
  {
    name: 'a table owned by another role',
    rules: ['table-owner'],
    as: 'superuser',
    sql: 'create role fixture_stranger; alter table fixture_settings owner to fixture_stranger',
  },
  {
    name: 'an id without its UUIDv7 check',
    rules: ['primary-key'],
    sql: 'alter table fixture_settings drop constraint fixture_settings_id_is_uuidv7',
  },
  {
    name: 'a primary key that is not id alone',
    rules: ['primary-key'],
    sql: 'alter table fixture_settings drop constraint fixture_settings_pkey, add primary key (id, name)',
  },
  {
    name: 'a camelCase column',
    rules: ['column-name'],
    sql: 'alter table fixture_settings add column "displayName" text',
  },
  ...['double precision', 'real', 'money', 'timestamp', 'timestamp(3)'].map((type) => ({
    name: `a ${type} column`,
    rules: ['column-type'] as Rule[],
    sql: `alter table fixture_settings add column measured ${type}`,
  })),
  ...['integer', 'numeric'].map((type) => ({
    name: `an amount in minor units stored as ${type}`,
    rules: ['minor-bigint'] as Rule[],
    sql: `alter table fixture_documents alter column amount_minor type ${type}`,
  })),
  {
    name: 'created_at without its default',
    rules: ['created-at'],
    sql: 'alter table fixture_settings alter column created_at drop default',
  },
  {
    name: 'created_at nullable',
    rules: ['created-at'],
    sql: 'alter table fixture_settings alter column created_at drop not null',
  },
  {
    name: 'an append-only table with updated_at',
    rules: ['kind-timestamps'],
    sql: 'alter table fixture_entries add column updated_at timestamptz not null default now()',
  },
  {
    name: 'a business table without archived_at',
    rules: ['kind-timestamps'],
    sql: 'alter table fixture_documents drop column archived_at',
  },
  {
    name: 'a platform table with a company_id column',
    rules: ['company-scope'],
    sql: 'alter table fixture_settings add column company_id uuid',
  },
  {
    name: 'a nullable company_id',
    rules: ['company-scope'],
    sql: 'alter table fixture_documents alter column company_id drop not null',
  },
  {
    name: 'a foreign key with no index',
    rules: ['foreign-key-index'],
    sql: 'drop index fixture_lines_company_entry_idx',
  },
  {
    name: 'a foreign key between company tables without company_id',
    rules: ['foreign-key-composite'],
    sql: `alter table fixture_lines add column document_id uuid references fixture_documents (id);
          create index fixture_lines_company_document_idx on fixture_lines (company_id, document_id)`,
  },
  {
    name: 'row-level security no longer forced',
    rules: ['rls'],
    sql: 'alter table fixture_documents no force row level security',
  },
  {
    name: 'row-level security disabled',
    rules: ['rls'],
    sql: 'alter table fixture_documents disable row level security',
  },
  {
    name: 'a second permissive policy, ORed with company_isolation',
    rules: ['company-policy'],
    sql: 'create policy fixture_open on fixture_documents using (true)',
  },
  {
    name: 'a permissive policy for the app role alone',
    rules: ['company-policy'],
    sql: 'create policy fixture_app_read on fixture_documents for select to mizan_app using (true)',
  },
  {
    name: 'company_isolation widened',
    rules: ['company-policy'],
    sql: 'alter policy company_isolation on fixture_documents using (true)',
  },
  {
    name: 'company_isolation without its WITH CHECK',
    rules: ['company-policy'],
    sql: `drop policy company_isolation on fixture_documents;
          create policy company_isolation on fixture_documents
            using (company_id = current_company_id())`,
  },
  {
    name: 'company_isolation dropped',
    rules: ['company-policy'],
    sql: 'drop policy company_isolation on fixture_documents',
  },
  {
    name: 'a secondary index that does not start with company_id',
    rules: ['index-company-first'],
    sql: 'create index fixture_documents_title_idx on fixture_documents (title)',
  },
  ...[
    'grant delete on fixture_documents to mizan_app',
    'grant truncate on fixture_settings to mizan_app',
    'grant trigger on fixture_settings to mizan_app',
    'grant references (id) on fixture_documents to mizan_app',
    'grant maintain on fixture_settings to mizan_app',
  ].map((sql) => ({ name: sql, rules: ['app-privilege'] as Rule[], sql })),
  ...[
    'grant update on fixture_entries to mizan_app',
    'grant update (created_at) on fixture_lines to mizan_app',
    'grant delete on fixture_lines to mizan_app',
  ].map((sql) => ({ name: sql, rules: ['append-only-grant'] as Rule[], sql })),
  ...[
    'grant select on fixture_documents to mizan_jobs',
    'grant select (name) on fixture_settings to mizan_jobs',
    'grant insert on fixture_settings to mizan_queue',
    'grant maintain on fixture_entries to mizan_queue',
    'grant select on fixture_settings to public',
  ].map((sql) => ({ name: sql, rules: ['role-privilege'] as Rule[], sql })),
  {
    name: 'an append-only table without its TRUNCATE trigger',
    rules: ['append-only-trigger'],
    sql: 'drop trigger fixture_entries_refuse_truncate on fixture_entries',
  },
  {
    name: 'an append-only table whose rows can be deleted',
    rules: ['append-only-trigger'],
    sql: `drop trigger fixture_lines_refuse_change on fixture_lines;
          create trigger fixture_lines_refuse_change before update on fixture_lines
            for each row execute function refuse_change();
          alter table fixture_lines enable always trigger fixture_lines_refuse_change`,
  },
  {
    name: 'an append-only table whose guard watches one column only',
    rules: ['append-only-trigger'],
    sql: `drop trigger fixture_entries_refuse_change on fixture_entries;
          create trigger fixture_entries_refuse_change
            before update of created_at or delete on fixture_entries
            for each row execute function refuse_change();
          alter table fixture_entries enable always trigger fixture_entries_refuse_change`,
  },
  {
    name: 'an append-only table whose guard fires only WHEN a condition holds',
    rules: ['append-only-trigger'],
    sql: `drop trigger fixture_lines_refuse_change on fixture_lines;
          create trigger fixture_lines_refuse_change before update or delete on fixture_lines
            for each row when (false) execute function refuse_change();
          alter table fixture_lines enable always trigger fixture_lines_refuse_change`,
  },
  {
    name: 'a guard a replica session would skip',
    rules: ['trigger-always'],
    sql: 'alter table fixture_entries enable trigger fixture_entries_refuse_change',
  },
  {
    name: 'a guard firing only in replica sessions',
    rules: ['trigger-always'],
    sql: 'alter table fixture_entries enable replica trigger fixture_entries_refuse_truncate',
  },
  {
    name: 'a disabled deferred check',
    rules: ['trigger-always'],
    sql: 'alter table fixture_lines disable trigger fixture_lines_balance',
  },
  ...['not deferrable', 'deferrable initially immediate'].map((timing) => ({
    name: `a constraint trigger ${timing}`,
    rules: ['constraint-trigger'] as Rule[],
    sql: `create constraint trigger fixture_lines_early after insert on fixture_lines ${timing}
            for each row execute function fixture_entry_balances();
          alter table fixture_lines enable always trigger fixture_lines_early`,
  })),
  {
    name: 'a SECURITY DEFINER function',
    rules: ['security-definer'],
    sql: 'create function fixture_definer() returns integer language sql security definer as $$ select 1 $$',
  },
  {
    name: 'current_company_id() replaced with a fallback',
    rules: ['pinned-function'],
    sql: `create or replace function current_company_id() returns uuid
            language sql stable parallel safe
            as $$ SELECT coalesce(nullif(current_setting('app.company_id', true), '')::uuid,
                                  '00000000-0000-7000-8000-000000000000') $$`,
  },
  {
    name: 'the deferred balance check replaced to accept anything',
    rules: ['pinned-function'],
    sql: `create or replace function fixture_entry_balances() returns trigger language plpgsql
            as $$ BEGIN RETURN NULL; END $$`,
  },
  {
    name: 'the deferred balance check firing only WHEN a condition holds',
    rules: ['guard-trigger'],
    sql: `drop trigger fixture_lines_balance on fixture_lines;
          create constraint trigger fixture_lines_balance after insert on fixture_lines
            deferrable initially deferred for each row when (new.amount_minor = 0)
            execute function fixture_entry_balances();
          alter table fixture_lines enable always trigger fixture_lines_balance`,
  },
  {
    name: 'the deferred balance check dropped from the entries',
    rules: ['guard-trigger'],
    sql: 'drop trigger fixture_entries_balance on fixture_entries',
  },
  {
    name: 'the deferred balance check calling another function',
    rules: ['guard-trigger'],
    sql: `drop trigger fixture_lines_balance on fixture_lines;
          create constraint trigger fixture_lines_balance after insert on fixture_lines
            deferrable initially deferred for each row execute function refuse_change();
          alter table fixture_lines enable always trigger fixture_lines_balance`,
  },
  {
    name: 'refuse_change() replaced to let the change through',
    rules: ['pinned-function'],
    sql: `create or replace function refuse_change() returns trigger language plpgsql
            as $$ BEGIN RETURN coalesce(NEW, OLD); END $$`,
  },
  {
    name: 'current_company_id() made volatile',
    rules: ['pinned-function'],
    sql: 'alter function current_company_id() volatile',
  },
  {
    name: 'current_company_id() given a search_path',
    rules: ['pinned-function'],
    sql: 'alter function current_company_id() set search_path = public',
  },
  {
    name: 'current_company_id() run with its owner’s rights',
    rules: ['pinned-function', 'security-definer'],
    sql: 'alter function current_company_id() security definer',
  },
  {
    name: 'an overload of current_company_id()',
    rules: ['pinned-function'],
    sql: 'create function current_company_id(fallback uuid) returns uuid language sql stable as $$ select fallback $$',
  },
  { name: 'another schema', rules: ['schemas'], sql: 'create schema fixture_hidden' },
  ...[
    'grant temporary on database :database to mizan_app',
    'grant temporary on database :database to public',
    'grant create on database :database to mizan_queue',
  ].map((sql) => ({ name: sql, rules: ['database-privilege'] as Rule[], sql })),
  ...[
    'grant create on schema public to mizan_app',
    'grant usage on schema pgboss to mizan_app',
    'grant usage on schema drizzle to mizan_jobs',
  ].map((sql) => ({ name: sql, rules: ['schema-privilege'] as Rule[], sql })),
  ...[
    'alter role mizan_app bypassrls',
    'alter role mizan_owner superuser',
    'alter role mizan_queue createdb',
    'alter role mizan_jobs inherit',
    'alter role mizan_jobs reset log_statement',
    `alter role mizan_jobs in database :database set log_statement = 'none'`,
    'alter role mizan_app set row_security = off',
  ].map((sql) => ({
    name: sql,
    rules: ['role-attributes'] as Rule[],
    as: 'superuser' as const,
    sql,
  })),
  {
    name: 'a role made a member of the owner role',
    rules: ['role-membership'],
    as: 'superuser',
    sql: 'grant mizan_owner to mizan_app',
  },
];

/** The violations found, as the app role, while `mutation` is applied; nothing is committed. */
async function underMutation(mutation: Mutation): Promise<Violation[]> {
  const client = await superuser.connect();
  try {
    await client.query('begin');
    if ((mutation.as ?? 'owner') === 'owner') await client.query(`set local role ${OWNER_ROLE}`);
    if (mutation.sql) await client.query(mutation.sql.replaceAll(':database', database));
    await client.query('set local role mizan_app');
    return await checkConventions(client, mutation.registry ?? registry, guards);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

describe('the migrated database with the fixture tables', () => {
  it('follows every convention, read as the app role', async () => {
    expect(await checkConventions(app.$client, registry, guards)).toEqual([]);
  });

  it('keeps the fixture tables out of the real registry', () => {
    for (const name of Object.keys(tableRegistry)) expect(name).not.toMatch(/^fixture_/);
    for (const name of Object.keys(fixtureRegistry)) expect(name).toMatch(/^fixture_/);
  });
});

describe('each convention, broken on purpose', () => {
  it.each(MUTATIONS)('$name: $rules', async (mutation) => {
    const violations = await underMutation(mutation);
    expect([...new Set(violations.map((v) => v.rule))].sort(), JSON.stringify(violations)).toEqual(
      [...mutation.rules].sort(),
    );
  });

  it('a restrictive policy, which only narrows company_isolation, breaks nothing', async () => {
    const mutation = {
      name: 'restrictive',
      rules: [],
      sql: 'create policy fixture_narrow on fixture_documents as restrictive using (true)',
    };
    expect(await underMutation(mutation)).toEqual([]);
  });

  it('covers every rule', () => {
    const proven = new Set(MUTATIONS.flatMap((m) => m.rules));
    expect(Object.keys(RULES).filter((rule) => !proven.has(rule as Rule))).toEqual([]);
  });
});
