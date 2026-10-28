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
    'Append-only: no updated_at or archived_at; business: both; queue and draft: updated_at; ledger-state and ephemeral: updated_at, no archived_at.',
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
  'ledger-state-trigger':
    'A ledger-state table refuses DELETE and TRUNCATE through unconditional refuse_delete() triggers, and a listed guard trigger checks every INSERT and UPDATE before it (ADR 0012).',
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
 * settings lock; S02's chart, dimension and rate rules; S03's ledger: the append-only tables, the
 * ledger state, the entry's chain, number, period, balance and reversal, the line's validity and
 * period balances, the dimension sets). S04 adds the open items' guards, S07 the period close.
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
    // S02: the chart's tree and lock, the roles' fit, the dimension and rate rules, and the
    // roots and built-in types of every company.
    {
      name: 'new_uuidv7',
      arguments: '',
      returns: 'uuid',
      language: 'sql',
      volatility: 'v',
      parallel: 'u',
      strict: false,
      leakproof: false,
      definer: false,
      config: null,
      owner: OWNER_ROLE,
      source: `
  SELECT encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
          PLACING substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6),
        52, 1),
      53, 1),
    'hex')::uuid
`,
    },
    {
      name: 'chart_account_rules',
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
  parent record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'chart_accounts: an account keeps its id and company'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.level = 1 AND (
      (NEW.code, NEW.level, NEW.parent_id, NEW.kind, NEW.class, NEW.normal_balance)
        IS DISTINCT FROM (OLD.code, OLD.level, OLD.parent_id, OLD.kind, OLD.class, OLD.normal_balance)
      OR NEW.archived_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'chart_accounts: root account % is only renamed', OLD.code
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF (OLD.first_posted_at IS NOT NULL OR (OLD.kind = 'header' AND EXISTS (
          SELECT 1 FROM public.chart_accounts c
          WHERE c.company_id = OLD.company_id AND c.parent_id = OLD.id)))
      AND (
        (NEW.code, NEW.parent_id, NEW.level, NEW.kind, NEW.class, NEW.normal_balance,
          NEW.currency, NEW.is_control, NEW.is_monetary)
          IS DISTINCT FROM (OLD.code, OLD.parent_id, OLD.level, OLD.kind, OLD.class,
            OLD.normal_balance, OLD.currency, OLD.is_control, OLD.is_monetary)
        OR (OLD.first_posted_at IS NOT NULL
          AND NEW.first_posted_at IS DISTINCT FROM OLD.first_posted_at)
      ) THEN
      RAISE EXCEPTION 'chart_accounts: account % is locked since its first use', OLD.code
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW.level > 1 THEN
    SELECT p.code, p.level, p.kind, p.archived_at INTO parent
    FROM public.chart_accounts p
    WHERE p.company_id = NEW.company_id AND p.id = NEW.parent_id
    FOR SHARE;
    IF NOT FOUND OR parent.kind <> 'header' OR parent.level <> NEW.level - 1
      OR left(NEW.code, char_length(parent.code)) <> parent.code
      OR (NEW.archived_at IS NULL AND parent.archived_at IS NOT NULL) THEN
      RAISE EXCEPTION 'chart_accounts: account % needs an unarchived header parent of the level above whose code it extends', NEW.code
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW.archived_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chart_accounts c
    WHERE c.company_id = NEW.company_id AND c.parent_id = NEW.id AND c.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'chart_accounts: account % has unarchived children', NEW.code
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.account_roles r
    WHERE r.company_id = NEW.company_id AND r.account_id = NEW.id AND r.archived_at IS NULL
      AND NOT (
        NEW.kind = 'postable' AND NEW.blocked_at IS NULL AND NEW.archived_at IS NULL
        AND CASE r.role
          WHEN 'conversion_rounding' THEN NEW.class IN ('revenue', 'expense')
          WHEN 'fx_realised_gain' THEN NEW.class = 'revenue'
          WHEN 'fx_unrealised_gain' THEN NEW.class = 'revenue'
          WHEN 'fx_realised_loss' THEN NEW.class = 'expense'
          WHEN 'fx_unrealised_loss' THEN NEW.class = 'expense'
          WHEN 'retained_earnings' THEN NEW.class = 'equity'
          ELSE false
        END
      )
  ) THEN
    RAISE EXCEPTION 'chart_accounts: account % holds an account role it would no longer fit', NEW.code
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.kind <> 'postable' AND EXISTS (
    SELECT 1 FROM public.account_required_dimensions d
    WHERE d.company_id = NEW.company_id AND d.account_id = NEW.id AND d.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'chart_accounts: header account % requires no dimension', NEW.code
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
`,
    },
    {
      name: 'account_required_dimension_rules',
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
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.company_id, NEW.account_id, NEW.dimension_type_id)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.account_id, OLD.dimension_type_id) THEN
    RAISE EXCEPTION 'account_required_dimensions: a row keeps its account and type'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.archived_at IS NULL AND (
    NOT EXISTS (
      SELECT 1 FROM public.chart_accounts a
      WHERE a.company_id = NEW.company_id AND a.id = NEW.account_id AND a.kind = 'postable'
      FOR SHARE
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.dimension_types t
      WHERE t.company_id = NEW.company_id AND t.id = NEW.dimension_type_id
        AND t.archived_at IS NULL
      FOR SHARE
    )
  ) THEN
    RAISE EXCEPTION 'account_required_dimensions: a postable account and an unarchived type'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
`,
    },
    {
      name: 'account_role_rules',
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
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.company_id, NEW.role)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.role) THEN
    RAISE EXCEPTION 'account_roles: a row keeps its role'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.archived_at IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.chart_accounts a
    WHERE a.company_id = NEW.company_id AND a.id = NEW.account_id
      AND a.kind = 'postable' AND a.blocked_at IS NULL AND a.archived_at IS NULL
      AND CASE NEW.role
        WHEN 'conversion_rounding' THEN a.class IN ('revenue', 'expense')
        WHEN 'fx_realised_gain' THEN a.class = 'revenue'
        WHEN 'fx_unrealised_gain' THEN a.class = 'revenue'
        WHEN 'fx_realised_loss' THEN a.class = 'expense'
        WHEN 'fx_unrealised_loss' THEN a.class = 'expense'
        WHEN 'retained_earnings' THEN a.class = 'equity'
        ELSE false
      END
    FOR SHARE
  ) THEN
    RAISE EXCEPTION 'account_roles: the account does not fit role %', NEW.role
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
`,
    },
    {
      name: 'dimension_type_rules',
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
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.company_id, NEW.code, NEW.builtin, NEW.parent_type_id)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.code, OLD.builtin, OLD.parent_type_id) THEN
    RAISE EXCEPTION 'dimension_types: a type keeps its code, built-in mark and parent type'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.archived_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.account_required_dimensions d
    WHERE d.company_id = NEW.company_id AND d.dimension_type_id = NEW.id
      AND d.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'dimension_types: type % is required by an account', NEW.code
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.archived_at IS NULL AND (TG_OP = 'INSERT' OR OLD.archived_at IS NOT NULL) THEN
    PERFORM 1 FROM public.company_settings s WHERE s.company_id = NEW.company_id FOR UPDATE;
    IF (SELECT count(*) FROM public.dimension_types t
        WHERE t.company_id = NEW.company_id AND t.archived_at IS NULL AND t.id <> NEW.id) >= 10 THEN
      RAISE EXCEPTION 'dimension_types: at most 10 active types'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
`,
    },
    {
      name: 'dimension_value_rules',
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
  value_type record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.company_id, NEW.type_id) IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.type_id)
    THEN
      RAISE EXCEPTION 'dimension_values: a value keeps its type'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.external_id IS NOT NULL AND (NEW.external_source, NEW.external_id)
      IS DISTINCT FROM (OLD.external_source, OLD.external_id) THEN
      RAISE EXCEPTION 'dimension_values: value % is linked to % for good', OLD.id, OLD.external_id
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  SELECT t.code, t.builtin, t.parent_type_id INTO value_type
  FROM public.dimension_types t
  WHERE t.company_id = NEW.company_id AND t.id = NEW.type_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dimension_values: unknown type' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.contract_kind IS NOT NULL) <> (value_type.builtin AND value_type.code = 'contract') THEN
    RAISE EXCEPTION 'dimension_values: a contract kind exactly on contract values'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.parent_value_id IS NOT NULL AND (value_type.parent_type_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.dimension_values p
    WHERE p.company_id = NEW.company_id AND p.id = NEW.parent_value_id
      AND p.type_id = value_type.parent_type_id
  )) THEN
    RAISE EXCEPTION 'dimension_values: the parent is a value of the parent type'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.parent_value_id IS NULL AND NEW.external_source = 'hub'
    AND value_type.parent_type_id IS NOT NULL THEN
    RAISE EXCEPTION 'dimension_values: a Hub contract names its client'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
`,
    },
    {
      name: 'rate_pair_rules',
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
  IF (NEW.id, NEW.company_id, NEW.base, NEW.quote)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.base, OLD.quote) THEN
    RAISE EXCEPTION 'rate_pairs: a pair keeps its currencies and orientation'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
`,
    },
    {
      name: 'exchange_rate_rules',
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
  IF NEW.supersedes_rate_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.exchange_rates r
    WHERE r.company_id = NEW.company_id AND r.id = NEW.supersedes_rate_id
      AND r.base = NEW.base AND r.quote = NEW.quote AND r.type = NEW.type
      AND r.effective_on = NEW.effective_on
  ) THEN
    RAISE EXCEPTION 'exchange_rates: a correction supersedes a row of its pair, type and date'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
`,
    },
    {
      name: 'create_company_chart_roots',
      arguments: 'company uuid',
      returns: 'void',
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
  client_type uuid := public.new_uuidv7();
BEGIN
  INSERT INTO public.chart_accounts
    (id, company_id, code, level, parent_id, kind, class, name, name_latin, normal_balance)
  VALUES
    (public.new_uuidv7(), company, '1', 1, NULL, 'header', 'asset', 'الأصول', 'Assets', 'debit'),
    (public.new_uuidv7(), company, '2', 1, NULL, 'header', 'liability', 'الخصوم', 'Liabilities', 'credit'),
    (public.new_uuidv7(), company, '3', 1, NULL, 'header', 'equity', 'حقوق الملكية', 'Equity', 'credit'),
    (public.new_uuidv7(), company, '4', 1, NULL, 'header', 'revenue', 'الإيرادات', 'Revenue', 'credit'),
    (public.new_uuidv7(), company, '5', 1, NULL, 'header', 'expense', 'المصاريف', 'Expenses', 'debit');
  INSERT INTO public.dimension_types
    (id, company_id, code, builtin, parent_type_id, name, name_latin, position)
  VALUES (client_type, company, 'client', true, NULL, 'العميل', 'Client', 1);
  INSERT INTO public.dimension_types
    (id, company_id, code, builtin, parent_type_id, name, name_latin, position)
  VALUES
    (public.new_uuidv7(), company, 'contract', true, client_type, 'العقد', 'Contract', 2),
    (public.new_uuidv7(), company, 'department', true, NULL, 'القسم', 'Department', 3),
    (public.new_uuidv7(), company, 'service', true, NULL, 'الخدمة', 'Service', 4);
END
`,
    },
    {
      name: 'company_settings_create_chart',
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
  PERFORM public.create_company_chart_roots(NEW.company_id);
  RETURN NULL;
END
`,
    },
    // S03's ledger guards (0012): the ledger state, the entry, the line, the period balances and
    // the dimension sets.
    {
      name: 'ledger_head_rules',
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
  IF TG_OP = 'INSERT' THEN
    IF NEW.entry_count <> 0 OR NEW.last_entry_id IS NOT NULL OR NEW.last_hash IS NOT NULL THEN
      RAISE EXCEPTION 'ledger_heads: a head starts with no entry'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.created_at)
    OR NEW.entry_count IS DISTINCT FROM OLD.entry_count + 1
    OR NOT EXISTS (
      SELECT 1 FROM public.journal_entries e
      WHERE e.company_id = NEW.company_id AND e.id = NEW.last_entry_id
        AND e.hash = NEW.last_hash AND e.sequence = NEW.entry_count
        AND e.previous_hash IS NOT DISTINCT FROM OLD.last_hash
    ) THEN
    RAISE EXCEPTION 'ledger_heads: the head of company % moves by one entry that follows it',
      OLD.company_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
`,
    },
    {
      name: 'entry_number_counter_rules',
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
  IF TG_OP = 'INSERT' THEN
    IF NEW.last_number <> 1 THEN
      RAISE EXCEPTION 'entry_number_counters: a fiscal year''s numbers start at 1'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.fiscal_year, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.fiscal_year, OLD.created_at)
    OR NEW.last_number IS DISTINCT FROM OLD.last_number + 1 THEN
    RAISE EXCEPTION 'entry_number_counters: a counter moves by one number at a time'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
`,
    },
    {
      name: 'entry_number_counter_used',
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
  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.company_id = NEW.company_id AND e.fiscal_year = NEW.fiscal_year
      AND e.number = NEW.last_number
  ) THEN
    RAISE EXCEPTION 'entry number % of fiscal year % was given but no entry took it',
      NEW.last_number, NEW.fiscal_year
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
`,
    },
    {
      name: 'period_rules',
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
  start_month smallint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'periods: period % changes only through the close (S07)', OLD.period
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT s.fiscal_year_start_month INTO start_month
  FROM public.company_settings s
  WHERE s.company_id = NEW.company_id;
  IF NOT FOUND OR NEW.state <> 'open'
    OR NEW.fiscal_year <> left(NEW.period, 4)::integer
      - (CASE WHEN right(NEW.period, 2)::integer >= start_month THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'periods: period % is made open, in the fiscal year of its month', NEW.period
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
`,
    },
    {
      name: 'journal_entry_rules',
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
  head record;
  settings record;
  period_state text;
BEGIN
  SELECT h.entry_count, h.last_hash INTO head
  FROM public.ledger_heads h
  WHERE h.company_id = NEW.company_id;
  IF NOT FOUND OR NEW.sequence IS DISTINCT FROM head.entry_count + 1
    OR NEW.previous_hash IS DISTINCT FROM head.last_hash THEN
    RAISE EXCEPTION 'journal_entries: an entry follows the head of its company''s chain'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.entry_number_counters c
    WHERE c.company_id = NEW.company_id AND c.fiscal_year = NEW.fiscal_year
      AND c.last_number = NEW.number
  ) THEN
    RAISE EXCEPTION 'journal_entries: entry % takes the number its counter has just given',
      NEW.number
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT s.fiscal_year_start_month, s.books_started_at INTO settings
  FROM public.company_settings s
  WHERE s.company_id = NEW.company_id;
  IF NOT FOUND OR settings.books_started_at IS NULL
    OR NEW.fiscal_year <> extract(year FROM NEW.entry_date)::integer
      - (CASE WHEN extract(month FROM NEW.entry_date) >= settings.fiscal_year_start_month
          THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'journal_entries: an entry is numbered in the fiscal year of its date, in started books'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.posted_at IS DISTINCT FROM date_trunc('milliseconds', now()) THEN
    RAISE EXCEPTION 'journal_entries: an entry is posted at its transaction time'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT p.state INTO period_state
  FROM public.periods p
  WHERE p.company_id = NEW.company_id AND p.period = to_char(NEW.entry_date, 'YYYY-MM')
  FOR SHARE;
  IF NOT FOUND OR period_state <> 'open' THEN
    RAISE EXCEPTION 'journal_entries: an entry dated % is in an open period', NEW.entry_date
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
`,
    },
    {
      name: 'journal_entry_balances',
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
  target uuid;
  entry record;
  totals record;
  keeps_parallel boolean;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    target := NEW.id;
  ELSE
    target := NEW.entry_id;
  END IF;
  SELECT e.line_count, e.sequence INTO entry
  FROM public.journal_entries e
  WHERE e.company_id = NEW.company_id AND e.id = target;
  SELECT count(*) AS lines, coalesce(sum(l.book_minor), 0) AS book,
         count(l.parallel_minor) AS parallel_lines, coalesce(sum(l.parallel_minor), 0) AS parallel
    INTO totals
  FROM public.journal_lines l
  WHERE l.company_id = NEW.company_id AND l.entry_id = target;
  SELECT s.parallel_currency IS NOT NULL INTO keeps_parallel
  FROM public.company_settings s
  WHERE s.company_id = NEW.company_id;
  IF entry.line_count IS NULL OR keeps_parallel IS NULL OR totals.lines < 2
    OR totals.lines <> entry.line_count OR totals.book <> 0
    OR totals.parallel_lines <> (CASE WHEN keeps_parallel THEN totals.lines ELSE 0 END)
    OR totals.parallel <> 0 THEN
    RAISE EXCEPTION 'journal entry % does not balance: % lines of %, book %, parallel %',
      target, totals.lines, entry.line_count, totals.book, totals.parallel
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_heads h
    WHERE h.company_id = NEW.company_id AND h.entry_count >= entry.sequence
  ) THEN
    RAISE EXCEPTION 'journal entry %: the chain head did not move past it', target
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
`,
    },
    {
      name: 'journal_entry_reverses',
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
  original record;
BEGIN
  IF NEW.reverses_entry_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT o.reverses_entry_id, o.entry_date, o.line_count INTO original
  FROM public.journal_entries o
  WHERE o.company_id = NEW.company_id AND o.id = NEW.reverses_entry_id;
  IF NOT FOUND OR original.reverses_entry_id IS NOT NULL OR original.entry_date > NEW.entry_date
    OR original.line_count <> NEW.line_count OR EXISTS (
      SELECT l.account_id, l.dimension_set_id, l.kind, l.ledger, l.currency,
             -l.amount_minor, -l.book_minor, -l.parallel_minor
      FROM public.journal_lines l
      WHERE l.company_id = NEW.company_id AND l.entry_id = NEW.reverses_entry_id
      EXCEPT ALL
      SELECT r.account_id, r.dimension_set_id, r.kind, r.ledger, r.currency,
             r.amount_minor, r.book_minor, r.parallel_minor
      FROM public.journal_lines r
      WHERE r.company_id = NEW.company_id AND r.entry_id = NEW.id
    ) THEN
    RAISE EXCEPTION 'journal entry % does not reverse entry % exactly', NEW.id, NEW.reverses_entry_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
`,
    },
    {
      name: 'journal_line_rules',
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
  account record;
  entry record;
  settings record;
BEGIN
  SELECT a.kind, a.currency, a.first_posted_at INTO account
  FROM public.chart_accounts a
  WHERE a.company_id = NEW.company_id AND a.id = NEW.account_id
  FOR SHARE;
  IF NOT FOUND OR account.kind <> 'postable' OR account.first_posted_at IS NULL THEN
    RAISE EXCEPTION 'journal_lines: a line posts to a postable account marked as used'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF account.currency IS NOT NULL AND account.currency <> NEW.currency THEN
    RAISE EXCEPTION 'journal_lines: account % takes % lines, not %', NEW.account_id,
      account.currency, NEW.currency
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT e.entry_date, e.reverses_entry_id INTO entry
  FROM public.journal_entries e
  WHERE e.company_id = NEW.company_id AND e.id = NEW.entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal_lines: a line belongs to an entry of its company'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT s.book_currency, s.parallel_currency INTO settings
  FROM public.company_settings s
  WHERE s.company_id = NEW.company_id;
  IF entry.entry_date < date '2026-01-01'
    AND 'SYP' IN (NEW.currency, settings.book_currency, coalesce(settings.parallel_currency, '')) THEN
    RAISE EXCEPTION 'journal_lines: no SYP amount is dated before 2026-01-01'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF entry.reverses_entry_id IS NULL AND EXISTS (
    SELECT 1 FROM public.account_required_dimensions r
    WHERE r.company_id = NEW.company_id AND r.account_id = NEW.account_id
      AND r.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.dimension_set_values v
        WHERE v.company_id = NEW.company_id AND v.set_id = NEW.dimension_set_id
          AND v.type_id = r.dimension_type_id
      )
  ) THEN
    RAISE EXCEPTION 'journal_lines: a line carries every dimension its account % requires',
      NEW.account_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
`,
    },
    {
      name: 'journal_line_period_balance',
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
  target_period uuid;
BEGIN
  SELECT p.id INTO target_period
  FROM public.journal_entries e
  JOIN public.periods p ON p.company_id = e.company_id AND p.period = to_char(e.entry_date, 'YYYY-MM')
  WHERE e.company_id = NEW.company_id AND e.id = NEW.entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal_lines: the period of the line''s entry is missing'
      USING ERRCODE = 'restrict_violation';
  END IF;
  INSERT INTO public.period_balances AS b (
    id, company_id, period_id, account_id, dimension_set_id, currency,
    debit_minor, credit_minor, book_debit_minor, book_credit_minor,
    parallel_debit_minor, parallel_credit_minor, line_count
  ) VALUES (
    public.new_uuidv7(), NEW.company_id, target_period, NEW.account_id, NEW.dimension_set_id,
    NEW.currency,
    greatest(NEW.amount_minor, 0), greatest(-NEW.amount_minor, 0),
    greatest(NEW.book_minor, 0), greatest(-NEW.book_minor, 0),
    CASE WHEN NEW.parallel_minor IS NULL THEN NULL ELSE greatest(NEW.parallel_minor, 0) END,
    CASE WHEN NEW.parallel_minor IS NULL THEN NULL ELSE greatest(-NEW.parallel_minor, 0) END,
    1
  )
  ON CONFLICT (company_id, period_id, account_id, dimension_set_id, currency) DO UPDATE SET
    debit_minor = b.debit_minor + excluded.debit_minor,
    credit_minor = b.credit_minor + excluded.credit_minor,
    book_debit_minor = b.book_debit_minor + excluded.book_debit_minor,
    book_credit_minor = b.book_credit_minor + excluded.book_credit_minor,
    parallel_debit_minor = b.parallel_debit_minor + excluded.parallel_debit_minor,
    parallel_credit_minor = b.parallel_credit_minor + excluded.parallel_credit_minor,
    line_count = b.line_count + 1,
    updated_at = now();
  RETURN NULL;
END
`,
    },
    {
      name: 'period_balance_rules',
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
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'period_balances: written only by the trigger on journal_lines'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    (NEW.id, NEW.company_id, NEW.period_id, NEW.account_id, NEW.dimension_set_id, NEW.currency,
      NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.period_id, OLD.account_id,
        OLD.dimension_set_id, OLD.currency, OLD.created_at)
    OR NEW.debit_minor < OLD.debit_minor OR NEW.credit_minor < OLD.credit_minor
    OR NEW.book_debit_minor < OLD.book_debit_minor OR NEW.book_credit_minor < OLD.book_credit_minor
    OR (NEW.parallel_debit_minor IS NULL) <> (OLD.parallel_debit_minor IS NULL)
    OR NEW.parallel_debit_minor < OLD.parallel_debit_minor
    OR NEW.parallel_credit_minor < OLD.parallel_credit_minor
    OR NEW.line_count <= OLD.line_count
  ) THEN
    RAISE EXCEPTION 'period_balances: a period balance keeps its key and only grows'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
`,
    },
    {
      name: 'dimension_set_keys',
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
  target uuid;
  set_key text;
  values_key text;
BEGIN
  IF TG_TABLE_NAME = 'dimension_sets' THEN
    target := NEW.id;
  ELSE
    target := NEW.set_id;
  END IF;
  SELECT s.key INTO set_key
  FROM public.dimension_sets s
  WHERE s.company_id = NEW.company_id AND s.id = target;
  SELECT coalesce(string_agg(v.type_id::text || ':' || v.value_id::text, ',' ORDER BY v.type_id), '')
    INTO values_key
  FROM public.dimension_set_values v
  WHERE v.company_id = NEW.company_id AND v.set_id = target;
  IF set_key IS NULL OR set_key <> values_key THEN
    RAISE EXCEPTION 'dimension set % does not hold the values its key names', target
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
`,
    },
    {
      name: 'company_settings_create_ledger_head',
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
  INSERT INTO public.ledger_heads (id, company_id, entry_count)
  VALUES (public.new_uuidv7(), NEW.company_id, 0);
  RETURN NULL;
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
    // S02's tables (0009): the rate table is append-only, the business tables are never deleted,
    // and each carries its rules; company_settings makes the chart roots of a new company.
    {
      table: 'exchange_rates',
      name: 'exchange_rates_refuse_change',
      function: 'refuse_change',
      deferred: false,
      on: ['UPDATE', 'DELETE'],
    },
    {
      table: 'exchange_rates',
      name: 'exchange_rates_refuse_truncate',
      function: 'refuse_change',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'chart_accounts',
      name: 'chart_accounts_refuse_delete',
      function: 'refuse_delete',
      deferred: false,
      on: ['DELETE'],
    },
    {
      table: 'chart_accounts',
      name: 'chart_accounts_refuse_truncate',
      function: 'refuse_delete',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'account_required_dimensions',
      name: 'account_required_dimensions_refuse_delete',
      function: 'refuse_delete',
      deferred: false,
      on: ['DELETE'],
    },
    {
      table: 'account_required_dimensions',
      name: 'account_required_dimensions_refuse_truncate',
      function: 'refuse_delete',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'account_roles',
      name: 'account_roles_refuse_delete',
      function: 'refuse_delete',
      deferred: false,
      on: ['DELETE'],
    },
    {
      table: 'account_roles',
      name: 'account_roles_refuse_truncate',
      function: 'refuse_delete',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'dimension_types',
      name: 'dimension_types_refuse_delete',
      function: 'refuse_delete',
      deferred: false,
      on: ['DELETE'],
    },
    {
      table: 'dimension_types',
      name: 'dimension_types_refuse_truncate',
      function: 'refuse_delete',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'dimension_values',
      name: 'dimension_values_refuse_delete',
      function: 'refuse_delete',
      deferred: false,
      on: ['DELETE'],
    },
    {
      table: 'dimension_values',
      name: 'dimension_values_refuse_truncate',
      function: 'refuse_delete',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'rate_pairs',
      name: 'rate_pairs_refuse_delete',
      function: 'refuse_delete',
      deferred: false,
      on: ['DELETE'],
    },
    {
      table: 'rate_pairs',
      name: 'rate_pairs_refuse_truncate',
      function: 'refuse_delete',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'bulletin_holidays',
      name: 'bulletin_holidays_refuse_delete',
      function: 'refuse_delete',
      deferred: false,
      on: ['DELETE'],
    },
    {
      table: 'bulletin_holidays',
      name: 'bulletin_holidays_refuse_truncate',
      function: 'refuse_delete',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'chart_accounts',
      name: 'chart_account_rules',
      function: 'chart_account_rules',
      deferred: false,
      on: ['INSERT', 'UPDATE'],
    },
    {
      table: 'account_required_dimensions',
      name: 'account_required_dimension_rules',
      function: 'account_required_dimension_rules',
      deferred: false,
      on: ['INSERT', 'UPDATE'],
    },
    {
      table: 'account_roles',
      name: 'account_role_rules',
      function: 'account_role_rules',
      deferred: false,
      on: ['INSERT', 'UPDATE'],
    },
    {
      table: 'dimension_types',
      name: 'dimension_type_rules',
      function: 'dimension_type_rules',
      deferred: false,
      on: ['INSERT', 'UPDATE'],
    },
    {
      table: 'dimension_values',
      name: 'dimension_value_rules',
      function: 'dimension_value_rules',
      deferred: false,
      on: ['INSERT', 'UPDATE'],
    },
    {
      table: 'rate_pairs',
      name: 'rate_pair_rules',
      function: 'rate_pair_rules',
      deferred: false,
      on: ['UPDATE'],
    },
    {
      table: 'exchange_rates',
      name: 'exchange_rate_rules',
      function: 'exchange_rate_rules',
      deferred: false,
      on: ['INSERT'],
    },
    {
      table: 'company_settings',
      name: 'company_settings_create_chart',
      function: 'company_settings_create_chart',
      deferred: false,
      on: ['INSERT'],
    },
    // S03's ledger (0012): the append-only ledger refuses every change, the ledger state every
    // deletion, and each table carries its guards; company_settings makes a new company's head.
    {
      table: 'posting_requests',
      name: 'posting_requests_refuse_change',
      function: 'refuse_change',
      deferred: false,
      on: ['UPDATE', 'DELETE'],
    },
    {
      table: 'posting_requests',
      name: 'posting_requests_refuse_truncate',
      function: 'refuse_change',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'journal_entries',
      name: 'journal_entries_refuse_change',
      function: 'refuse_change',
      deferred: false,
      on: ['UPDATE', 'DELETE'],
    },
    {
      table: 'journal_entries',
      name: 'journal_entries_refuse_truncate',
      function: 'refuse_change',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'journal_lines',
      name: 'journal_lines_refuse_change',
      function: 'refuse_change',
      deferred: false,
      on: ['UPDATE', 'DELETE'],
    },
    {
      table: 'journal_lines',
      name: 'journal_lines_refuse_truncate',
      function: 'refuse_change',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'line_conversions',
      name: 'line_conversions_refuse_change',
      function: 'refuse_change',
      deferred: false,
      on: ['UPDATE', 'DELETE'],
    },
    {
      table: 'line_conversions',
      name: 'line_conversions_refuse_truncate',
      function: 'refuse_change',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'dimension_sets',
      name: 'dimension_sets_refuse_change',
      function: 'refuse_change',
      deferred: false,
      on: ['UPDATE', 'DELETE'],
    },
    {
      table: 'dimension_sets',
      name: 'dimension_sets_refuse_truncate',
      function: 'refuse_change',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'dimension_set_values',
      name: 'dimension_set_values_refuse_change',
      function: 'refuse_change',
      deferred: false,
      on: ['UPDATE', 'DELETE'],
    },
    {
      table: 'dimension_set_values',
      name: 'dimension_set_values_refuse_truncate',
      function: 'refuse_change',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'ledger_heads',
      name: 'ledger_heads_refuse_delete',
      function: 'refuse_delete',
      deferred: false,
      on: ['DELETE'],
    },
    {
      table: 'ledger_heads',
      name: 'ledger_heads_refuse_truncate',
      function: 'refuse_delete',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'entry_number_counters',
      name: 'entry_number_counters_refuse_delete',
      function: 'refuse_delete',
      deferred: false,
      on: ['DELETE'],
    },
    {
      table: 'entry_number_counters',
      name: 'entry_number_counters_refuse_truncate',
      function: 'refuse_delete',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'periods',
      name: 'periods_refuse_delete',
      function: 'refuse_delete',
      deferred: false,
      on: ['DELETE'],
    },
    {
      table: 'periods',
      name: 'periods_refuse_truncate',
      function: 'refuse_delete',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'period_balances',
      name: 'period_balances_refuse_delete',
      function: 'refuse_delete',
      deferred: false,
      on: ['DELETE'],
    },
    {
      table: 'period_balances',
      name: 'period_balances_refuse_truncate',
      function: 'refuse_delete',
      deferred: false,
      on: ['TRUNCATE'],
    },
    {
      table: 'ledger_heads',
      name: 'ledger_head_rules',
      function: 'ledger_head_rules',
      deferred: false,
      on: ['INSERT', 'UPDATE'],
    },
    {
      table: 'entry_number_counters',
      name: 'entry_number_counter_rules',
      function: 'entry_number_counter_rules',
      deferred: false,
      on: ['INSERT', 'UPDATE'],
    },
    {
      table: 'entry_number_counters',
      name: 'entry_number_counter_used',
      function: 'entry_number_counter_used',
      deferred: true,
      on: ['INSERT', 'UPDATE'],
    },
    {
      table: 'periods',
      name: 'period_rules',
      function: 'period_rules',
      deferred: false,
      on: ['INSERT', 'UPDATE'],
    },
    {
      table: 'period_balances',
      name: 'period_balance_rules',
      function: 'period_balance_rules',
      deferred: false,
      on: ['INSERT', 'UPDATE'],
    },
    {
      table: 'journal_entries',
      name: 'journal_entry_rules',
      function: 'journal_entry_rules',
      deferred: false,
      on: ['INSERT'],
    },
    {
      table: 'journal_entries',
      name: 'journal_entries_balance',
      function: 'journal_entry_balances',
      deferred: true,
      on: ['INSERT'],
    },
    {
      table: 'journal_lines',
      name: 'journal_lines_balance',
      function: 'journal_entry_balances',
      deferred: true,
      on: ['INSERT'],
    },
    {
      table: 'journal_entries',
      name: 'journal_entries_reversal',
      function: 'journal_entry_reverses',
      deferred: true,
      on: ['INSERT'],
    },
    {
      table: 'journal_lines',
      name: 'journal_line_rules',
      function: 'journal_line_rules',
      deferred: false,
      on: ['INSERT'],
    },
    {
      table: 'journal_lines',
      name: 'journal_line_period_balance',
      function: 'journal_line_period_balance',
      deferred: false,
      on: ['INSERT'],
    },
    {
      table: 'dimension_sets',
      name: 'dimension_sets_key_matches',
      function: 'dimension_set_keys',
      deferred: true,
      on: ['INSERT'],
    },
    {
      table: 'dimension_set_values',
      name: 'dimension_set_values_key_matches',
      function: 'dimension_set_keys',
      deferred: true,
      on: ['INSERT'],
    },
    {
      table: 'company_settings',
      name: 'company_settings_create_ledger_head',
      function: 'company_settings_create_ledger_head',
      deferred: false,
      on: ['INSERT'],
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
          : info.kind === 'ephemeral' || info.kind === 'ledger-state'
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
      if (ephemeral && p.role === APP_ROLE && !(p.select && p.insert && p.update && p.delete)) {
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
    if (info?.kind === 'ledger-state') {
      const before = (t: Trigger) => t.unconditional && t.type & BEFORE && !(t.type & INSTEAD);
      const refused = ownTriggers
        .filter((t) => t.function === 'refuse_delete' && before(t))
        .reduce((events, t) => events | (t.type & (DELETE | TRUNCATE)), 0);
      const guarded = ownTriggers
        .filter(
          (t) =>
            before(t) &&
            t.type & ROW &&
            guards.triggers.some(
              (g) => g.table === name && g.name === t.name && g.function === t.function,
            ),
        )
        .reduce((events, t) => events | (t.type & (INSERT | UPDATE)), 0);
      if (refused !== (DELETE | TRUNCATE) || guarded !== (INSERT | UPDATE)) {
        fail(
          'ledger-state-trigger',
          name,
          `refuse_delete() covers events ${refused}, a guard covers events ${guarded}`,
        );
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
