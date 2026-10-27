-- The guards and grants of S02's tables (0007 and 0008), as packages/db/CLAUDE.md and the
-- /db-migration skill write them: forced RLS with the one company_isolation policy, grants by kind
-- (the app role reads, adds and changes business rows and never deletes; it reads and adds rate
-- rows only), refuse_delete() on the business tables, refuse_change() on the append-only rate
-- table, the chart's tree and lock after first use, the account roles' fit, the dimension rules,
-- the rate corrections, and the five roots and four built-in dimension types of every company,
-- made in its creation transaction and backfilled here for the existing (test) companies. Every
-- trigger is ENABLE ALWAYS (ADR 0008); every guard function is pinned in test/conventions.ts.
-- Guard functions name their tables with the schema. Nothing is granted to mizan_jobs,
-- mizan_queue or PUBLIC.

-- A UUIDv7 made in the database, for the rows a trigger creates (the application makes every
-- other id): 48 bits of Unix milliseconds over a random UUIDv4 whose version bits become 0111.
CREATE FUNCTION new_uuidv7() RETURNS uuid
  LANGUAGE sql
  VOLATILE
  AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
          PLACING substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6),
        52, 1),
      53, 1),
    'hex')::uuid
$$;
--> statement-breakpoint

-- RLS and grants: the seven business tables.
ALTER TABLE chart_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chart_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON chart_accounts
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE account_required_dimensions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE account_required_dimensions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON account_required_dimensions
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE account_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE account_roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON account_roles
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE dimension_types ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dimension_types FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON dimension_types
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE dimension_values ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dimension_values FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON dimension_values
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE rate_pairs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rate_pairs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON rate_pairs
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE bulletin_holidays ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bulletin_holidays FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON bulletin_holidays
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
REVOKE ALL ON chart_accounts, account_required_dimensions, account_roles, dimension_types,
  dimension_values, rate_pairs, bulletin_holidays FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON chart_accounts, account_required_dimensions, account_roles,
  dimension_types, dimension_values, rate_pairs, bulletin_holidays TO mizan_app;
--> statement-breakpoint

-- exchange_rates: company append-only (ADR 0005 invariant 10, ADR 0007): the app role reads and
-- adds only; refuse_change() refuses UPDATE, DELETE and TRUNCATE for every role. A correction is a
-- newer row.
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE exchange_rates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON exchange_rates
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
CREATE TRIGGER exchange_rates_refuse_change BEFORE UPDATE OR DELETE ON exchange_rates
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER exchange_rates_refuse_truncate BEFORE TRUNCATE ON exchange_rates
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE exchange_rates ENABLE ALWAYS TRIGGER exchange_rates_refuse_change;
--> statement-breakpoint
ALTER TABLE exchange_rates ENABLE ALWAYS TRIGGER exchange_rates_refuse_truncate;
--> statement-breakpoint
REVOKE ALL ON exchange_rates FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON exchange_rates TO mizan_app;
--> statement-breakpoint

-- The business tables are archived, never deleted (S02 check 7): refuse_delete() before DELETE
-- (row) and TRUNCATE (statement) for every role, the owner included.
CREATE TRIGGER chart_accounts_refuse_delete BEFORE DELETE ON chart_accounts
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER chart_accounts_refuse_truncate BEFORE TRUNCATE ON chart_accounts
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE chart_accounts ENABLE ALWAYS TRIGGER chart_accounts_refuse_delete;
--> statement-breakpoint
ALTER TABLE chart_accounts ENABLE ALWAYS TRIGGER chart_accounts_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER account_required_dimensions_refuse_delete BEFORE DELETE
  ON account_required_dimensions FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER account_required_dimensions_refuse_truncate BEFORE TRUNCATE
  ON account_required_dimensions FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE account_required_dimensions
  ENABLE ALWAYS TRIGGER account_required_dimensions_refuse_delete;
--> statement-breakpoint
ALTER TABLE account_required_dimensions
  ENABLE ALWAYS TRIGGER account_required_dimensions_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER account_roles_refuse_delete BEFORE DELETE ON account_roles
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER account_roles_refuse_truncate BEFORE TRUNCATE ON account_roles
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE account_roles ENABLE ALWAYS TRIGGER account_roles_refuse_delete;
--> statement-breakpoint
ALTER TABLE account_roles ENABLE ALWAYS TRIGGER account_roles_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER dimension_types_refuse_delete BEFORE DELETE ON dimension_types
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER dimension_types_refuse_truncate BEFORE TRUNCATE ON dimension_types
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE dimension_types ENABLE ALWAYS TRIGGER dimension_types_refuse_delete;
--> statement-breakpoint
ALTER TABLE dimension_types ENABLE ALWAYS TRIGGER dimension_types_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER dimension_values_refuse_delete BEFORE DELETE ON dimension_values
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER dimension_values_refuse_truncate BEFORE TRUNCATE ON dimension_values
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE dimension_values ENABLE ALWAYS TRIGGER dimension_values_refuse_delete;
--> statement-breakpoint
ALTER TABLE dimension_values ENABLE ALWAYS TRIGGER dimension_values_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER rate_pairs_refuse_delete BEFORE DELETE ON rate_pairs
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER rate_pairs_refuse_truncate BEFORE TRUNCATE ON rate_pairs
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE rate_pairs ENABLE ALWAYS TRIGGER rate_pairs_refuse_delete;
--> statement-breakpoint
ALTER TABLE rate_pairs ENABLE ALWAYS TRIGGER rate_pairs_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER bulletin_holidays_refuse_delete BEFORE DELETE ON bulletin_holidays
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER bulletin_holidays_refuse_truncate BEFORE TRUNCATE ON bulletin_holidays
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE bulletin_holidays ENABLE ALWAYS TRIGGER bulletin_holidays_refuse_delete;
--> statement-breakpoint
ALTER TABLE bulletin_holidays ENABLE ALWAYS TRIGGER bulletin_holidays_refuse_truncate;
--> statement-breakpoint

-- The chart's tree and lock (S02 checks 1, 2 and 5, rules 3–7). Before every insert and update:
-- - an account's company and id never change;
-- - a root (level 1) is only renamed;
-- - a child's parent is an unarchived header of the level above whose code starts its own, read
--   FOR SHARE so the parent cannot become postable or archived meanwhile;
-- - the lock after first use: once first_posted_at is set, the code, parent, level, kind, class,
--   normal balance, currency and flags never change, nor first_posted_at; a header is locked the
--   same way once it has a child (so it never becomes postable with children);
-- - an archived account has no unarchived child, and an account in an active role is neither
--   blocked nor archived nor a header;
-- - a header has no active required dimension.
-- The API checks first and answers with S02's codes; this is the database's own guard.
CREATE FUNCTION chart_account_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
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
  IF (NEW.archived_at IS NOT NULL OR NEW.blocked_at IS NOT NULL OR NEW.kind <> 'postable')
    AND EXISTS (
      SELECT 1 FROM public.account_roles r
      WHERE r.company_id = NEW.company_id AND r.account_id = NEW.id AND r.archived_at IS NULL
    ) THEN
    RAISE EXCEPTION 'chart_accounts: account % holds an account role', NEW.code
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
$$;
--> statement-breakpoint
CREATE TRIGGER chart_account_rules BEFORE INSERT OR UPDATE ON chart_accounts
  FOR EACH ROW EXECUTE FUNCTION chart_account_rules();
--> statement-breakpoint
ALTER TABLE chart_accounts ENABLE ALWAYS TRIGGER chart_account_rules;
--> statement-breakpoint

-- A required dimension (S02 check 4, rule 9): an active row names a postable account and an
-- unarchived type, both read FOR SHARE; its account and type never change.
CREATE FUNCTION account_required_dimension_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
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
$$;
--> statement-breakpoint
CREATE TRIGGER account_required_dimension_rules BEFORE INSERT OR UPDATE
  ON account_required_dimensions FOR EACH ROW EXECUTE FUNCTION account_required_dimension_rules();
--> statement-breakpoint
ALTER TABLE account_required_dimensions ENABLE ALWAYS TRIGGER account_required_dimension_rules;
--> statement-breakpoint

-- An account role (S02 rule 7): an active row points to a postable, unblocked, unarchived account
-- that fits the role, read FOR SHARE; its role never changes.
CREATE FUNCTION account_role_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
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
$$;
--> statement-breakpoint
CREATE TRIGGER account_role_rules BEFORE INSERT OR UPDATE ON account_roles
  FOR EACH ROW EXECUTE FUNCTION account_role_rules();
--> statement-breakpoint
ALTER TABLE account_roles ENABLE ALWAYS TRIGGER account_role_rules;
--> statement-breakpoint

-- A dimension type (S02 "Dimensions", rule 9): its code, built-in mark and parent type never
-- change; a type is archived only when no account requires it; at most 10 types are active, counted
-- under a lock on the company's settings row so two additions cannot both pass.
CREATE FUNCTION dimension_type_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
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
$$;
--> statement-breakpoint
CREATE TRIGGER dimension_type_rules BEFORE INSERT OR UPDATE ON dimension_types
  FOR EACH ROW EXECUTE FUNCTION dimension_type_rules();
--> statement-breakpoint
ALTER TABLE dimension_types ENABLE ALWAYS TRIGGER dimension_type_rules;
--> statement-breakpoint

-- A dimension value (S02 "Dimensions", rules 10–11): its type never changes; a contract kind
-- exactly on values of the built-in contract type; a parent only on values of a type with a parent
-- type, and of that type, required on a Hub contract; the Hub link, once set, never changes.
CREATE FUNCTION dimension_value_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
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
$$;
--> statement-breakpoint
CREATE TRIGGER dimension_value_rules BEFORE INSERT OR UPDATE ON dimension_values
  FOR EACH ROW EXECUTE FUNCTION dimension_value_rules();
--> statement-breakpoint
ALTER TABLE dimension_values ENABLE ALWAYS TRIGGER dimension_value_rules;
--> statement-breakpoint

-- A rate pair keeps its currencies: their orientation is fixed (ADR 0011).
CREATE FUNCTION rate_pair_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.id, NEW.company_id, NEW.base, NEW.quote)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.base, OLD.quote) THEN
    RAISE EXCEPTION 'rate_pairs: a pair keeps its currencies and orientation'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER rate_pair_rules BEFORE UPDATE ON rate_pairs
  FOR EACH ROW EXECUTE FUNCTION rate_pair_rules();
--> statement-breakpoint
ALTER TABLE rate_pairs ENABLE ALWAYS TRIGGER rate_pair_rules;
--> statement-breakpoint

-- A rate correction (S02 rule 15) supersedes a row of the same pair, type and date. With the
-- unique indexes of 0008 (one original row per pair, type and date; a row superseded once) the
-- rows of a date form one chain, whose last row is in force.
CREATE FUNCTION exchange_rate_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
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
$$;
--> statement-breakpoint
CREATE TRIGGER exchange_rate_rules BEFORE INSERT ON exchange_rates
  FOR EACH ROW EXECUTE FUNCTION exchange_rate_rules();
--> statement-breakpoint
ALTER TABLE exchange_rates ENABLE ALWAYS TRIGGER exchange_rate_rules;
--> statement-breakpoint

-- The five root accounts (S02 "Accounts") and the four built-in dimension types (rule 9) of a
-- company, in the company context of the caller. Names and codes as `ROOT_ACCOUNTS` and
-- `BUILTIN_DIMENSION_TYPES` of @vertex-mizan/contracts (a test keeps them equal).
CREATE FUNCTION create_company_chart_roots(company uuid) RETURNS void
  LANGUAGE plpgsql
  AS $$
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
$$;
--> statement-breakpoint

-- Every company gets them in its creation transaction: S01's creation (the web form and the
-- admin:create-company command) inserts the company's settings row inside withCompany, and this
-- trigger runs there, in the same company context.
CREATE FUNCTION company_settings_create_chart() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  PERFORM public.create_company_chart_roots(NEW.company_id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER company_settings_create_chart AFTER INSERT ON company_settings
  FOR EACH ROW EXECUTE FUNCTION company_settings_create_chart();
--> statement-breakpoint
ALTER TABLE company_settings ENABLE ALWAYS TRIGGER company_settings_create_chart;
--> statement-breakpoint

-- The existing companies (test data only, S02 "Migration and compatibility"): each in its own
-- company context, set for this transaction only, then cleared.
DO $$
DECLARE
  company record;
BEGIN
  FOR company IN SELECT c.id FROM public.companies c LOOP
    PERFORM set_config('app.company_id', company.id::text, true);
    PERFORM public.create_company_chart_roots(company.id);
  END LOOP;
  PERFORM set_config('app.company_id', '', true);
END
$$;
