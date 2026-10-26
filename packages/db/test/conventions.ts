import type pg from 'pg';
import type { TableInfo } from '../src/index.js';

// The data conventions of ADR 0003, ADR 0005 and ADR 0008, read from a database's catalog, so they
// hold whatever the schema files or custom migrations say. `checkConventions` returns every
// violation; the convention test expects none on the migrated database, and proves each rule by
// breaking a fixture table (or a role) in a rolled-back transaction and expecting exactly that
// rule to fail.

export const OWNER_ROLE = 'mizan_owner';
export const APP_ROLE = 'mizan_app';
export const JOBS_ROLE = 'mizan_jobs';
export const QUEUE_ROLE = 'mizan_queue';
export const ROLES = [APP_ROLE, JOBS_ROLE, OWNER_ROLE, QUEUE_ROLE];

/** Every rule, by id. */
export const RULES = {
  registry: 'Every table in public is in the registry, and every registered table exists.',
  'relation-kind': 'No view, materialized view or foreign table, but pg-boss’s own.',
  'rewrite-rule':
    'No table has a rewrite rule, which could redirect or drop a write that no trigger then sees.',
  'table-schema':
    'Tables live in public; besides them only the migration journal and pg-boss’s own tables.',
  'table-owner': 'The owner role owns every table.',
  'primary-key': 'The primary key is the uuid column id, checked to be a UUIDv7.',
  'column-name': 'Column names are snake_case.',
  'column-type': 'No real, double precision, money or zoneless timestamp column.',
  'minor-bigint': 'A *_minor amount column is bigint (ADR 0007).',
  'created-at': 'created_at is a timestamptz, not null, defaulting to now().',
  'kind-timestamps':
    'Append-only: no updated_at or archived_at; business: both; queue and draft: updated_at; ephemeral: updated_at, no archived_at.',
  'ephemeral-scope': 'An ephemeral table is a platform table: no company data is ever deleted.',
  'ephemeral-grant':
    'The app role holds SELECT, INSERT, UPDATE and DELETE on an ephemeral table, so used tokens are deleted.',
  'ephemeral-reference':
    'No foreign key references an ephemeral table, whose rows are deleted (the audit logs keep their ids without one).',
  'company-scope': 'company_id (uuid, not null) exactly on company tables.',
  'foreign-key-index': 'Every foreign key is covered by a full index.',
  'foreign-key-composite':
    'A foreign key between company tables leads with company_id on both sides.',
  rls: 'A company table enables and forces row-level security.',
  'company-policy':
    'A company table has one permissive policy: company_isolation, for every role and command.',
  'index-company-first': 'Every secondary index of a company table starts with company_id.',
  'app-privilege':
    'The app role has no TRUNCATE, TRIGGER, MAINTAIN or REFERENCES, and DELETE on ephemeral tables only (archive instead).',
  'append-only-grant': 'No role but the owner may UPDATE or DELETE an append-only table.',
  'role-privilege': 'The jobs and queue roles and PUBLIC hold no privilege on any table.',
  'append-only-trigger':
    'An append-only table refuses UPDATE, DELETE and TRUNCATE through unconditional refuse_change() triggers.',
  'trigger-always':
    'Every trigger is ENABLE ALWAYS, so a replica session cannot skip it (ADR 0008).',
  'constraint-trigger':
    'A constraint trigger is AFTER … FOR EACH ROW, DEFERRABLE INITIALLY DEFERRED (ADR 0008).',
  'security-definer': 'No function runs with its owner’s rights.',
  'pinned-function':
    'Every guard function (current_company_id(), refuse_change(), the deferred checks) is exactly as its migration made it.',
  'guard-trigger':
    'Every listed guard trigger is on its table, on its events, unconditional, row-level (statement-level for TRUNCATE), calling its pinned function.',
  inheritance:
    'No table inherits from another or is a partition, which would add rows past its guards.',
  'database-privilege':
    'The runtime roles and PUBLIC cannot create temporary tables, which shadow guarded tables, or schemas.',
  schemas: 'The schemas are public, drizzle and pgboss, owned by the owner role.',
  'schema-privilege':
    'Only the owner creates in public; pg-boss’s schema is open to the queue role only.',
  'role-attributes':
    'No role is a superuser or bypasses RLS; the jobs role is logged without values; no other power.',
  'role-membership': 'No role is a member of another.',
} as const;

export type Rule = keyof typeof RULES;

export type Violation = { rule: Rule; subject: string; detail: string };

const COMPANY_POLICY = '(company_id = current_company_id())';
const UUIDV7_CHECK = 'CHECK (((uuid_extract_version(id) = 7) IS TRUE))';
const FORBIDDEN_TYPE = /^(real|double precision|money|timestamp(\(\d\))? without time zone)$/;
const TIMESTAMPTZ = 'timestamp with time zone';
// pg_trigger.tgtype bits.
const ROW = 1;
const BEFORE = 2;
const DELETE = 8;
const UPDATE = 16;
const TRUNCATE = 32;
const INSTEAD = 64;
const INSERT = 4;

/** A guard function, pinned exactly as its migration creates it: a `CREATE OR REPLACE` fails. */
export type PinnedFunction = {
  name: string;
  arguments: string;
  returns: string;
  language: string;
  volatility: string;
  parallel: string;
  strict: boolean;
  leakproof: boolean;
  definer: boolean;
  config: string[] | null;
  owner: string;
  source: string;
};

/**
 * A guard trigger a table must keep: on at least the events `on`, with no WHEN condition and no
 * column list, calling a pinned function, row-level (statement-level for TRUNCATE, the only way
 * PostgreSQL fires on it); `deferred` ones are constraint triggers, checked at commit (ADR 0008).
 */
export type GuardTrigger = {
  table: string;
  name: string;
  function: string;
  deferred: boolean;
  on: ('INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE')[];
};

export type Guards = { functions: PinnedFunction[]; triggers: GuardTrigger[] };

/**
 * The guards of the migrations: every guard function, pinned, and every guard trigger (S01's
 * settings lock). The ledger's balance, reversal, open-item and period guards join them with S03.
 */
export const GUARDS: Guards = {
  functions: [
    {
      name: 'current_company_id',
      arguments: '',
      returns: 'uuid',
      language: 'sql',
      volatility: 's',
      parallel: 's',
      strict: false,
      leakproof: false,
      definer: false,
      config: null,
      owner: OWNER_ROLE,
      source: " SELECT nullif(current_setting('app.company_id', true), '')::uuid ",
    },
    {
      name: 'refuse_change',
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
  RAISE EXCEPTION '% is append-only: % refused', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
`,
    },
    {
      name: 'company_settings_lock',
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
  IF OLD.books_started_at IS NOT NULL AND (
    NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.book_currency IS DISTINCT FROM OLD.book_currency
    OR NEW.book_rate_type IS DISTINCT FROM OLD.book_rate_type
    OR NEW.book_accepts_transaction_rate IS DISTINCT FROM OLD.book_accepts_transaction_rate
    OR NEW.parallel_currency IS DISTINCT FROM OLD.parallel_currency
    OR NEW.parallel_rate_type IS DISTINCT FROM OLD.parallel_rate_type
    OR NEW.parallel_accepts_transaction_rate IS DISTINCT FROM OLD.parallel_accepts_transaction_rate
    OR NEW.fiscal_year_start_month IS DISTINCT FROM OLD.fiscal_year_start_month
    OR NEW.books_started_at IS DISTINCT FROM OLD.books_started_at
  ) THEN
    RAISE EXCEPTION 'company_settings of company % are locked since its first posted entry',
      OLD.company_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
`,
    },
    {
      name: 'refuse_delete',
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
  RAISE EXCEPTION '% is never deleted: % refused', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
`,
    },
  ],
  triggers: [
    // The settings lock (S01 rule 11): before every update of a company's ledger settings.
    {
      table: 'company_settings',
      name: 'company_settings_lock',
      function: 'company_settings_lock',
      deferred: false,
      on: ['UPDATE'],
    },
    // company_settings is never deleted, which would also undo the lock.
    {
      table: 'company_settings',
      name: 'company_settings_refuse_delete',
      function: 'refuse_delete',
      deferred: false,
      on: ['DELETE'],
    },
    {
      table: 'company_settings',
      name: 'company_settings_refuse_truncate',
      function: 'refuse_delete',
      deferred: false,
      on: ['TRUNCATE'],
    },
  ],
};

type Table = { schema: string; name: string; owner: string; rls: boolean; forced: boolean };
type Column = {
  table: string;
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
};
type Index = {
  table: string;
  name: string;
  primary: boolean;
  partial: boolean;
  columns: string[];
};
type Constraint = {
  table: string;
  name: string;
  type: string;
  definition: string;
  columns: string[];
  references: string | null;
  referencedColumns: string[];
};
type Policy = {
  table: string;
  name: string;
  permissive: boolean;
  roles: string[];
  command: string;
  using: string | null;
  check: string | null;
};
type Trigger = {
  table: string;
  name: string;
  type: number;
  enabled: string;
  constraint: boolean;
  deferrable: boolean;
  deferred: boolean;
  /** No WHEN condition and no UPDATE OF column list: it fires on every row of its events. */
  unconditional: boolean;
  function: string;
};
type Privileges = {
  table: string;
  role: string;
  select: boolean;
  insert: boolean;
  update: boolean;
  delete: boolean;
  truncate: boolean;
  references: boolean;
  trigger: boolean;
  maintain: boolean;
  updateColumn: boolean;
  referencesColumn: boolean;
  anyColumn: boolean;
};

const SYSTEM_SCHEMAS = `n.nspname not in ('pg_catalog', 'information_schema')
  and n.nspname not like 'pg\\_toast%' and n.nspname not like 'pg\\_temp%'`;

const attributeNames = (relation: string, keys: string) => `
  array(select a.attname::text
        from unnest(${keys}) with ordinality as u(attnum, position)
        join pg_attribute a on a.attrelid = ${relation} and a.attnum = u.attnum
        order by u.position)`;

/** Every violation of the conventions in the database `db` is connected to, read from its catalog. */
export async function checkConventions(
  db: pg.Pool | pg.PoolClient,
  registry: Record<string, TableInfo>,
  guards: Guards = GUARDS,
): Promise<Violation[]> {
  const read = async <T>(text: string, values: unknown[] = []) =>
    (await db.query(text, values)).rows as T[];
  const violations: Violation[] = [];
  const fail = (rule: Rule, subject: string, detail: string) => {
    violations.push({ rule, subject, detail });
  };

  const allTables = await read<Table>(`
    select n.nspname as schema, c.relname as name, pg_get_userbyid(c.relowner) as owner,
           c.relrowsecurity as rls, c.relforcerowsecurity as forced
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and ${SYSTEM_SCHEMAS}
    order by 1, 2`);
  const otherRelations = await read<{ schema: string; name: string; kind: string; owner: string }>(`
    select n.nspname as schema, c.relname as name, c.relkind::text as kind,
           pg_get_userbyid(c.relowner) as owner
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('v', 'm', 'f') and ${SYSTEM_SCHEMAS}`);
  const rewriteRules = await read<{ table: string; name: string }>(`
    select c.relname as table, r.rulename as name
    from pg_rewrite r join pg_class c on c.oid = r.ev_class
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')`);
  const columns = await read<Column>(`
    select c.relname as table, a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
           not a.attnotnull as nullable, pg_get_expr(d.adbin, d.adrelid) as default
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      and a.attnum > 0 and not a.attisdropped`);
  const indexes = await read<Index>(`
    select c.relname as table, ic.relname as name, i.indisprimary as primary,
           i.indpred is not null as partial, ${attributeNames('i.indrelid', 'i.indkey')} as columns
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_class ic on ic.oid = i.indexrelid
    where c.relnamespace = 'public'::regnamespace`);
  const constraints = await read<Constraint>(`
    select c.relname as table, k.conname as name, k.contype::text as type,
           pg_get_constraintdef(k.oid) as definition,
           ${attributeNames('k.conrelid', 'k.conkey')} as columns,
           f.relname as references,
           ${attributeNames('k.confrelid', 'k.confkey')} as "referencedColumns"
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    left join pg_class f on f.oid = k.confrelid
    where c.relnamespace = 'public'::regnamespace`);
  const policies = await read<Policy>(`
    select c.relname as table, p.polname as name, p.polpermissive as permissive,
           array(select case when r = 0 then 'public' else pg_get_userbyid(r)::text end
                 from unnest(p.polroles) as r order by 1) as roles,
           p.polcmd::text as command, pg_get_expr(p.polqual, p.polrelid) as using,
           pg_get_expr(p.polwithcheck, p.polrelid) as check
    from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relnamespace = 'public'::regnamespace`);
  const triggers = await read<Trigger>(`
    select c.relname as table, t.tgname as name, t.tgtype::int as type, t.tgenabled::text as enabled,
           t.tgconstraint <> 0 as constraint, t.tgdeferrable as deferrable,
           t.tginitdeferred as deferred,
           t.tgqual is null and cardinality(t.tgattr::int2[]) = 0 as unconditional,
           case when p.pronamespace = 'public'::regnamespace then p.proname::text end as function
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal and c.relnamespace = 'public'::regnamespace`);
  const privileges = await read<Privileges>(
    `select c.relname as table, r.role,
            has_table_privilege(r.role, c.oid, 'SELECT') as select,
            has_table_privilege(r.role, c.oid, 'INSERT') as insert,
            has_table_privilege(r.role, c.oid, 'UPDATE') as update,
            has_table_privilege(r.role, c.oid, 'DELETE') as delete,
            has_table_privilege(r.role, c.oid, 'TRUNCATE') as truncate,
            has_table_privilege(r.role, c.oid, 'REFERENCES') as references,
            has_table_privilege(r.role, c.oid, 'TRIGGER') as trigger,
            has_table_privilege(r.role, c.oid, 'MAINTAIN') as maintain,
            has_any_column_privilege(r.role, c.oid, 'UPDATE') as "updateColumn",
            has_any_column_privilege(r.role, c.oid, 'REFERENCES') as "referencesColumn",
            has_any_column_privilege(r.role, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
              as "anyColumn"
     from pg_class c cross join unnest($1::text[]) as r(role)
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')`,
    [[APP_ROLE, JOBS_ROLE, QUEUE_ROLE, 'public']],
  );

  // Tables outside public: only the migration journal and pg-boss's own tables, which pg-boss
  // installs and owns as the queue role (its worker tests pin who reaches them).
  for (const table of allTables.filter((t) => t.schema !== 'public')) {
    const journal = table.schema === 'drizzle' && table.name === '__drizzle_migrations';
    const queue = table.schema === 'pgboss' && table.owner === QUEUE_ROLE;
    if (!journal && !queue) {
      fail('table-schema', `${table.schema}.${table.name}`, `owned by ${table.owner}`);
    }
  }
  for (const relation of otherRelations) {
    if (!(relation.schema === 'pgboss' && relation.owner === QUEUE_ROLE)) {
      fail('relation-kind', `${relation.schema}.${relation.name}`, `relkind ${relation.kind}`);
    }
  }

  for (const rule of rewriteRules) fail('rewrite-rule', rule.table, rule.name);

  const tables = allTables.filter((t) => t.schema === 'public');
  const names = new Set(tables.map((t) => t.name));
  for (const name of Object.keys(registry)) {
    if (!names.has(name)) fail('registry', name, 'registered, but no such table');
  }

  const columnsOf = (table: string) => columns.filter((c) => c.table === table);
  const column = (table: string, name: string) =>
    columns.find((c) => c.table === table && c.name === name);
  const startsWith = (list: string[], prefix: string[]) =>
    prefix.every((name, i) => list[i] === name);
  const isCompany = (table: string | null) => !!table && registry[table]?.scope === 'company';

  for (const table of tables) {
    const name = table.name;
    const info = registry[name];
    if (!info) fail('registry', name, 'not in the registry');
    if (table.owner !== OWNER_ROLE) fail('table-owner', name, `owned by ${table.owner}`);

    const primary = indexes.find((i) => i.table === name && i.primary);
    const checked = constraints.some(
      (c) => c.table === name && c.type === 'c' && c.definition === UUIDV7_CHECK,
    );
    if (primary?.columns.join() !== 'id' || column(name, 'id')?.type !== 'uuid' || !checked) {
      fail('primary-key', name, `primary key (${primary?.columns.join(', ') ?? ''})`);
    }

    for (const c of columnsOf(name)) {
      if (!/^[a-z][a-z0-9_]*$/.test(c.name)) fail('column-name', name, c.name);
      if (FORBIDDEN_TYPE.test(c.type)) fail('column-type', name, `${c.name} is ${c.type}`);
      if (c.name.endsWith('_minor') && c.type !== 'bigint') {
        fail('minor-bigint', name, `${c.name} is ${c.type}`);
      }
    }

    const created = column(name, 'created_at');
    if (created?.type !== TIMESTAMPTZ || created.nullable || created.default !== 'now()') {
      fail('created-at', name, JSON.stringify(created ?? null));
    }

    if (info) {
      const updated = column(name, 'updated_at');
      const archived = column(name, 'archived_at');
      const hasUpdated = updated?.type === TIMESTAMPTZ && !updated.nullable;
      const hasArchived = archived?.type === TIMESTAMPTZ && archived.nullable;
      const ok =
        info.kind === 'append-only'
          ? !updated && !archived
          : info.kind === 'ephemeral'
            ? hasUpdated && !archived
            : hasUpdated && (info.kind !== 'business' || hasArchived);
      if (!ok) fail('kind-timestamps', name, `${info.kind}: updated_at, archived_at as found`);

      const company = column(name, 'company_id');
      if (info.scope === 'company' ? company?.type !== 'uuid' || company.nullable : company) {
        fail('company-scope', name, `${info.scope} table, company_id ${company?.type ?? 'absent'}`);
      }
      if (info.kind === 'ephemeral' && info.scope !== 'platform') {
        fail('ephemeral-scope', name, `${info.scope} table`);
      }
    }

    const own = indexes.filter((i) => i.table === name);
    for (const fk of constraints.filter((c) => c.table === name && c.type === 'f')) {
      // A partial index leaves rows out, so it never covers a foreign key.
      const covered = own.some(
        (index) =>
          !index.partial &&
          (startsWith(index.columns, fk.columns) ||
            (index.columns[0] === 'company_id' && startsWith(index.columns.slice(1), fk.columns))),
      );
      if (!covered) fail('foreign-key-index', name, fk.definition);
      if (fk.references && registry[fk.references]?.kind === 'ephemeral') {
        fail('ephemeral-reference', name, fk.definition);
      }
      if (
        isCompany(name) &&
        isCompany(fk.references) &&
        (fk.columns[0] !== 'company_id' || fk.referencedColumns[0] !== 'company_id')
      ) {
        fail('foreign-key-composite', name, fk.definition);
      }
    }

    if (isCompany(name)) {
      if (!table.rls || !table.forced) {
        fail('rls', name, `enabled ${table.rls}, forced ${table.forced}`);
      }
      const permissive = policies.filter((p) => p.table === name && p.permissive);
      const isolation = permissive.length === 1 ? permissive[0] : undefined;
      if (
        isolation?.name !== 'company_isolation' ||
        isolation.roles.join() !== 'public' ||
        isolation.command !== '*' ||
        isolation.using !== COMPANY_POLICY ||
        isolation.check !== COMPANY_POLICY
      ) {
        fail('company-policy', name, JSON.stringify(permissive));
      }
      for (const index of own.filter((i) => !i.primary && i.columns[0] !== 'company_id')) {
        fail('index-company-first', name, index.name);
      }
    }

    const appendOnly = info?.kind === 'append-only';
    const ephemeral = info?.kind === 'ephemeral';
    for (const p of privileges.filter((p) => p.table === name)) {
      if (
        p.role === APP_ROLE &&
        (p.truncate ||
          p.trigger ||
          p.maintain ||
          p.references ||
          p.referencesColumn ||
          (p.delete && !appendOnly && !ephemeral))
      ) {
        fail('app-privilege', name, JSON.stringify(p));
      }
      if (
        ephemeral &&
        p.role === APP_ROLE &&
        !(p.select && p.insert && p.update && p.delete)
      ) {
        fail('ephemeral-grant', name, JSON.stringify(p));
      }
      if (appendOnly && (p.update || p.updateColumn || p.delete)) {
        fail('append-only-grant', name, `${p.role}: ${JSON.stringify(p)}`);
      }
      const any =
        p.select ||
        p.insert ||
        p.update ||
        p.delete ||
        p.truncate ||
        p.references ||
        p.trigger ||
        p.maintain;
      if (p.role !== APP_ROLE && (any || p.anyColumn)) {
        fail('role-privilege', name, `${p.role}: ${JSON.stringify(p)}`);
      }
    }

    const ownTriggers = triggers.filter((t) => t.table === name);
    if (appendOnly) {
      const refused = ownTriggers
        .filter(
          (t) =>
            t.function === 'refuse_change' &&
            t.unconditional &&
            t.type & BEFORE &&
            !(t.type & INSTEAD),
        )
        .reduce((events, t) => events | (t.type & (UPDATE | DELETE | TRUNCATE)), 0);
      if (refused !== (UPDATE | DELETE | TRUNCATE)) {
        fail('append-only-trigger', name, `refuse_change() covers events ${refused}`);
      }
    }
    for (const trigger of ownTriggers) {
      if (trigger.enabled !== 'A') {
        fail('trigger-always', name, `${trigger.name} enabled ${trigger.enabled}`);
      }
      const after = !(trigger.type & BEFORE) && !(trigger.type & INSTEAD);
      if (
        trigger.constraint &&
        !(after && trigger.type & ROW && trigger.deferrable && trigger.deferred)
      ) {
        fail('constraint-trigger', name, trigger.name);
      }
    }
  }

  const definers = await read<{ name: string }>(`
    select n.nspname || '.' || p.proname as name
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and ${SYSTEM_SCHEMAS}`);
  for (const definer of definers) fail('security-definer', definer.name, 'SECURITY DEFINER');

  const pinned = await read<PinnedFunction>(
    `select p.proname as name, pg_get_function_identity_arguments(p.oid) as arguments,
            format_type(p.prorettype, null) as returns, l.lanname as language,
            p.provolatile::text as volatility, p.proparallel::text as parallel,
            p.proisstrict as strict, p.proleakproof as leakproof, p.prosecdef as definer,
            p.proconfig as config, pg_get_userbyid(p.proowner) as owner, p.prosrc as source
     from pg_proc p join pg_language l on l.oid = p.prolang
     where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`,
    [guards.functions.map((f) => f.name)],
  );
  for (const expected of guards.functions) {
    const found = pinned.filter((f) => f.name === expected.name);
    if (found.length !== 1 || JSON.stringify(found[0]) !== JSON.stringify(expected)) {
      fail('pinned-function', `${expected.name}()`, JSON.stringify(found));
    }
  }

  for (const guard of guards.triggers) {
    if (!guards.functions.some((f) => f.name === guard.function)) {
      throw new Error(`Guard trigger ${guard.name} calls ${guard.function}(), which is not pinned`);
    }
    const found = triggers.find((t) => t.table === guard.table && t.name === guard.name);
    const bits = { INSERT, UPDATE, DELETE, TRUNCATE };
    const events = guard.on.reduce((all, event) => all | bits[event], 0);
    const rowLevel = !guard.on.includes('TRUNCATE');
    if (
      !found ||
      found.function !== guard.function ||
      !found.unconditional ||
      found.constraint !== guard.deferred ||
      Boolean(found.type & ROW) !== rowLevel ||
      (found.type & events) !== events
    ) {
      fail('guard-trigger', guard.table, `${guard.name}: ${JSON.stringify(found ?? null)}`);
    }
  }

  const inherited = await read<{ child: string; parent: string }>(`
    select c.relname as child, p.relname as parent
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent
    where c.relnamespace = 'public'::regnamespace or p.relnamespace = 'public'::regnamespace`);
  for (const link of inherited) fail('inheritance', link.child, `inherits from ${link.parent}`);

  const databasePrivileges = await read<{ role: string; temporary: boolean; create: boolean }>(
    `select r.role,
            has_database_privilege(r.role, current_database(), 'TEMPORARY') as temporary,
            has_database_privilege(r.role, current_database(), 'CREATE') as create
     from unnest($1::text[]) as r(role)`,
    [[APP_ROLE, JOBS_ROLE, QUEUE_ROLE, 'public']],
  );
  for (const p of databasePrivileges.filter((p) => p.temporary || p.create)) {
    fail('database-privilege', p.role, `temporary ${p.temporary}, create ${p.create}`);
  }

  const schemas = await read<{ name: string; owner: string }>(`
    select n.nspname as name, pg_get_userbyid(n.nspowner) as owner
    from pg_namespace n where ${SYSTEM_SCHEMAS} order by 1`);
  if (schemas.map((s) => s.name).join() !== 'drizzle,pgboss,public') {
    fail('schemas', 'database', schemas.map((s) => s.name).join(', '));
  }
  for (const schema of schemas) {
    // public belongs to pg_database_owner (PostgreSQL 15 and later), that is the owner role.
    const owners = schema.name === 'public' ? [OWNER_ROLE, 'pg_database_owner'] : [OWNER_ROLE];
    if (!owners.includes(schema.owner)) fail('schemas', schema.name, `owned by ${schema.owner}`);
  }

  const creators = await read<{ role: string }>(
    `select r.role from unnest($1::text[]) as r(role)
     where has_schema_privilege(r.role, 'public', 'CREATE')`,
    [[APP_ROLE, JOBS_ROLE, QUEUE_ROLE, 'public']],
  );
  for (const creator of creators) fail('schema-privilege', 'public', `${creator.role} may CREATE`);
  const grants = await read<{ schema: string; grantee: string; privilege: string }>(`
    select n.nspname as schema,
           case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee)::text end
             as grantee,
           a.privilege_type as privilege
    from pg_namespace n, aclexplode(n.nspacl) a
    where n.nspname in ('drizzle', 'pgboss') and a.grantee <> n.nspowner
    order by 1, 2, 3`);
  const expectedGrants = [`pgboss ${QUEUE_ROLE} CREATE`, `pgboss ${QUEUE_ROLE} USAGE`];
  const foundGrants = grants.map((g) => `${g.schema} ${g.grantee} ${g.privilege}`);
  if (foundGrants.join() !== expectedGrants.join()) {
    fail('schema-privilege', 'drizzle, pgboss', foundGrants.join(', '));
  }

  const roles = await read<{
    name: string;
    superuser: boolean;
    bypass: boolean;
    createRole: boolean;
    createDb: boolean;
    replication: boolean;
    inherit: boolean;
    settings: string[];
  }>(
    `select r.rolname as name, r.rolsuper as superuser, r.rolbypassrls as bypass,
            r.rolcreaterole as "createRole", r.rolcreatedb as "createDb",
            r.rolreplication as replication, r.rolinherit as inherit,
            array(select coalesce(d.datname, '*') || ':' || setting
                  from pg_db_role_setting s
                  left join pg_database d on d.oid = s.setdatabase,
                  unnest(s.setconfig) as setting
                  where s.setrole = r.oid order by 1) as settings
     from pg_roles r where r.rolname = any($1) order by 1`,
    [ROLES],
  );
  if (roles.map((r) => r.name).join() !== ROLES.join()) {
    fail('role-attributes', 'roles', `found ${roles.map((r) => r.name).join(', ')}`);
  }
  for (const role of roles) {
    // The owner may create databases locally and in CI, for the throwaway test databases.
    const runtime = role.name !== OWNER_ROLE;
    // Every statement of the jobs role is logged, without its values (ADR 0003); only a superuser
    // may change either setting.
    const settings =
      role.name === JOBS_ROLE ? ['*:log_parameter_max_length=0', '*:log_statement=all'] : [];
    if (
      role.superuser ||
      role.bypass ||
      role.createRole ||
      role.replication ||
      (runtime && (role.createDb || role.inherit)) ||
      role.settings.join() !== settings.join()
    ) {
      fail('role-attributes', role.name, JSON.stringify(role));
    }
  }

  const memberships = await read<{ member: string; role: string }>(
    `select pg_get_userbyid(member) as member, pg_get_userbyid(roleid) as role
     from pg_auth_members
     where pg_get_userbyid(member) = any($1) or pg_get_userbyid(roleid) = any($1)`,
    [ROLES],
  );
  for (const m of memberships) fail('role-membership', m.member, `member of ${m.role}`);

  return violations;
}
