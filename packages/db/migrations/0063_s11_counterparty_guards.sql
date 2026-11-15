-- S11 PR 1 (ADR 0022): counterparties and cash kinds, between the columns (0062) and the
-- counterparty type's check (0064).
--
-- 1. The migration refuses to run, naming the company, while a company holds what step 2 could not
--    take, so it is fixed first (synthetic data only so far):
--    - a custom dimension type coded `supplier` or `worker`, which the built-in one of that code
--      would collide with (`dimension_types_company_id_code_key`);
--    - more than four active custom dimension types, which the two built-in ones would take past
--      the limit of ten (S11 "Dimensions");
--    - an open item with no counterparty on a control account, which could never be moved once its
--      account requires the client (S11 rule 5).
DO $$
DECLARE
  company record;
  taken text;
  custom integer;
  orphan text;
BEGIN
  FOR company IN SELECT c.id FROM public.companies c LOOP
    PERFORM set_config('app.company_id', company.id::text, true);
    SELECT string_agg(t.code, ', ' ORDER BY t.code) INTO taken
    FROM public.dimension_types t
    WHERE t.company_id = company.id AND NOT t.builtin AND t.code IN ('supplier', 'worker');
    IF taken IS NOT NULL THEN
      RAISE EXCEPTION 'S11: company % has custom dimension types coded %; rename them first',
        company.id, taken
        USING ERRCODE = 'restrict_violation';
    END IF;
    SELECT count(*) INTO custom
    FROM public.dimension_types t
    WHERE t.company_id = company.id AND NOT t.builtin AND t.archived_at IS NULL;
    IF custom > 4 THEN
      RAISE EXCEPTION 'S11: company % has % active custom dimension types; archive all but four first',
        company.id, custom
        USING ERRCODE = 'restrict_violation';
    END IF;
    SELECT string_agg(DISTINCT a.code, ', ' ORDER BY a.code) INTO orphan
    FROM public.open_items i
    JOIN public.chart_accounts a ON a.company_id = i.company_id AND a.id = i.account_id
    WHERE i.company_id = company.id AND i.counterparty_value_id IS NULL;
    IF orphan IS NOT NULL THEN
      RAISE EXCEPTION 'S11: company % has open items with no client on accounts %',
        company.id, orphan
        USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;
  PERFORM set_config('app.company_id', '', true);
END
$$;
--> statement-breakpoint
-- 2. Every existing company, each in its own company context, set for this transaction only, then
--    cleared:
--    - gains the built-in types `supplier` and `worker` (S11 "Dimensions"), each audited
--      `dimension_type.created` by the system;
--    - its control accounts take the counterparty type `client` (ADR 0022 "Consequences"), the
--      only one S04 knew, and each requires the client dimension (as every template's control
--      account already does). The lock after first use of 0053 does not cover the new column yet,
--      so a used account takes it too.
DO $$
DECLARE
  company record;
  type_row record;
  client_type uuid;
BEGIN
  FOR company IN SELECT c.id FROM public.companies c LOOP
    PERFORM set_config('app.company_id', company.id::text, true);
    FOR type_row IN
      INSERT INTO public.dimension_types
        (id, company_id, code, builtin, parent_type_id, name, name_latin, position)
      SELECT public.new_uuidv7(), company.id, v.code, true, NULL, v.name, v.name_latin, v.position
      FROM (VALUES
        ('supplier', 'المورّد', 'Supplier', 5),
        ('worker', 'العامل', 'Worker', 6)
      ) AS v(code, name, name_latin, position)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.dimension_types t WHERE t.company_id = company.id AND t.code = v.code
      )
      RETURNING id, code, name, name_latin, position
    LOOP
      INSERT INTO public.audit_entries
        (id, company_id, actor_kind, actor_name, request_id, action, entity_type, entity_id, after)
      VALUES (
        public.new_uuidv7(), company.id, 'system', 'Vertex Mizan', 'migration:0063',
        'dimension_type.created', 'dimension_type', type_row.id,
        jsonb_build_object('code', type_row.code, 'name', type_row.name,
          'nameLatin', type_row.name_latin, 'position', type_row.position)
      );
    END LOOP;
    SELECT t.id INTO client_type
    FROM public.dimension_types t
    WHERE t.company_id = company.id AND t.builtin AND t.code = 'client';
    UPDATE public.chart_accounts
    SET counterparty_type = 'client', updated_at = now()
    WHERE company_id = company.id AND is_control AND counterparty_type IS NULL;
    INSERT INTO public.account_required_dimensions (id, company_id, account_id, dimension_type_id)
    SELECT public.new_uuidv7(), company.id, a.id, client_type
    FROM public.chart_accounts a
    WHERE a.company_id = company.id AND a.is_control AND NOT EXISTS (
      SELECT 1 FROM public.account_required_dimensions d
      WHERE d.company_id = a.company_id AND d.account_id = a.id
        AND d.dimension_type_id = client_type AND d.archived_at IS NULL
    );
  END LOOP;
  PERFORM set_config('app.company_id', '', true);
END
$$;
--> statement-breakpoint
-- 3. A new company's built-in types (0009) gain `supplier` and `worker`.
CREATE OR REPLACE FUNCTION create_company_chart_roots(company uuid) RETURNS void
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
    (public.new_uuidv7(), company, 'service', true, NULL, 'الخدمة', 'Service', 4),
    (public.new_uuidv7(), company, 'supplier', true, NULL, 'المورّد', 'Supplier', 5),
    (public.new_uuidv7(), company, 'worker', true, NULL, 'العامل', 'Worker', 6);
END
$$;
--> statement-breakpoint
-- 4. The lock after first use (S02 rule 5, 0053) covers the counterparty type and the cash kind
--    (S11 "Data": a box turned into a bank to escape rule 8 is refused).
CREATE OR REPLACE FUNCTION chart_account_rules() RETURNS trigger
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
          NEW.currency, NEW.is_control, NEW.item_kind, NEW.counterparty_type, NEW.cash_kind,
          NEW.is_monetary)
          IS DISTINCT FROM (OLD.code, OLD.parent_id, OLD.level, OLD.kind, OLD.class,
            OLD.normal_balance, OLD.currency, OLD.is_control, OLD.item_kind,
            OLD.counterparty_type, OLD.cash_kind, OLD.is_monetary)
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
        AND CASE r.role::text
          WHEN 'conversion_rounding' THEN NEW.class IN ('revenue', 'expense')
          WHEN 'fx_realised_gain' THEN NEW.class = 'revenue'
          WHEN 'fx_unrealised_gain' THEN NEW.class = 'revenue'
          WHEN 'fx_realised_loss' THEN NEW.class = 'expense'
          WHEN 'fx_unrealised_loss' THEN NEW.class = 'expense'
          WHEN 'retained_earnings' THEN NEW.class = 'equity'
        WHEN 'pre_opening_result' THEN NEW.class = 'equity'
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
$$;
--> statement-breakpoint
-- 5. A control account requires its counterparty dimension (S11 rule 5, ADR 0022): at commit, a
--    control account holds an active requirement of the built-in type of its counterparty type,
--    read again from the account as it stands (so the account and its requirement may be written
--    in either order in one transaction); and that requirement is never archived while the
--    account is a control account of that type.
CREATE FUNCTION chart_account_counterparty_required() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  account record;
BEGIN
  SELECT a.code, a.is_control, a.counterparty_type INTO account
  FROM public.chart_accounts a
  WHERE a.company_id = NEW.company_id AND a.id = NEW.id;
  IF account.is_control AND NOT EXISTS (
    SELECT 1 FROM public.account_required_dimensions d
    JOIN public.dimension_types t ON t.company_id = d.company_id AND t.id = d.dimension_type_id
    WHERE d.company_id = NEW.company_id AND d.account_id = NEW.id AND d.archived_at IS NULL
      AND t.builtin AND t.code = account.counterparty_type::text
  ) THEN
    RAISE EXCEPTION 'chart_accounts: control account % requires its % dimension', account.code,
      account.counterparty_type
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER chart_account_counterparty_required
  AFTER INSERT OR UPDATE ON chart_accounts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION chart_account_counterparty_required();
--> statement-breakpoint
ALTER TABLE chart_accounts ENABLE ALWAYS TRIGGER chart_account_counterparty_required;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION account_required_dimension_rules() RETURNS trigger
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
  IF NEW.archived_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chart_accounts a
    JOIN public.dimension_types t ON t.company_id = a.company_id AND t.id = NEW.dimension_type_id
    WHERE a.company_id = NEW.company_id AND a.id = NEW.account_id AND a.is_control
      AND t.builtin AND t.code = a.counterparty_type::text
  ) THEN
    RAISE EXCEPTION 'account_required_dimensions: a control account keeps its counterparty dimension'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- 6. An item as it is inserted (0022, S11 "Open items"): its counterparty is its dimension set's
--    value of its account's counterparty type, so the value's type is the account's (none when
--    the set has none), and a running item has one.
CREATE OR REPLACE FUNCTION open_item_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  account record;
  set_counterparty uuid;
BEGIN
  SELECT a.kind, a.is_control, a.item_kind, a.currency, a.counterparty_type INTO account
  FROM public.chart_accounts a
  WHERE a.company_id = NEW.company_id AND a.id = NEW.account_id
  FOR SHARE;
  IF NOT FOUND OR account.kind <> 'postable' OR NOT account.is_control
    OR account.item_kind IS DISTINCT FROM NEW.kind THEN
    RAISE EXCEPTION 'open_items: an item is on a control account of its kind'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF account.currency IS NOT NULL AND account.currency <> NEW.currency THEN
    RAISE EXCEPTION 'open_items: account % takes % items, not %', NEW.account_id,
      account.currency, NEW.currency
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT v.value_id INTO set_counterparty
  FROM public.dimension_set_values v
  JOIN public.dimension_types t ON t.company_id = v.company_id AND t.id = v.type_id
  WHERE v.company_id = NEW.company_id AND v.set_id = NEW.dimension_set_id
    AND t.builtin AND t.code = account.counterparty_type::text;
  IF set_counterparty IS DISTINCT FROM NEW.counterparty_value_id THEN
    RAISE EXCEPTION 'open_items: an item''s counterparty is its dimension set''s value of its account''s counterparty type'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.company_id = NEW.company_id AND e.id = NEW.opened_by_entry_id
  ) THEN
    RAISE EXCEPTION 'open_items: an item is opened by an entry of its company'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- 7. A movement as it is inserted (0053; owner, 2026-11-14, ADR 0022 "Consequences"): a running
--    item's line is on the item's account and currency and its dimension set holds the item's
--    counterparty, so it may carry a contract beside it (S11 rule 3); a document item's line keeps
--    the item's dimension set exactly. Every other rule is 0053's.
CREATE OR REPLACE FUNCTION open_item_movement_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  line record;
  entry record;
  item record;
BEGIN
  SELECT l.entry_id, l.account_id, l.dimension_set_id, l.currency, l.kind, l.amount_minor,
         l.book_minor, l.parallel_minor INTO line
  FROM public.journal_lines l
  WHERE l.company_id = NEW.company_id AND l.id = NEW.line_id;
  SELECT e.entry_date, e.source, e.reverses_entry_id INTO entry
  FROM public.journal_entries e
  WHERE e.company_id = NEW.company_id AND e.id = line.entry_id;
  SELECT i.account_id, i.dimension_set_id, i.currency, i.kind, i.source, i.opened_by_entry_id,
    i.hub_document, i.counterparty_value_id
    INTO item
  FROM public.open_items i
  WHERE i.company_id = NEW.company_id AND i.id = NEW.item_id;
  IF line.entry_id IS NULL OR entry.entry_date IS NULL OR item.account_id IS NULL
    OR NEW.entry_id <> line.entry_id OR NEW.entry_date <> entry.entry_date
    OR (line.account_id, line.currency) IS DISTINCT FROM (item.account_id, item.currency)
    OR (item.kind = 'document' AND line.dimension_set_id IS DISTINCT FROM item.dimension_set_id)
    OR (item.kind = 'running' AND line.dimension_set_id IS DISTINCT FROM item.dimension_set_id
      AND NOT EXISTS (
        SELECT 1 FROM public.dimension_set_values v
        WHERE v.company_id = NEW.company_id AND v.set_id = line.dimension_set_id
          AND v.value_id = item.counterparty_value_id
      ))
    OR (NEW.amount_minor, NEW.book_minor, NEW.parallel_minor)
      IS DISTINCT FROM (line.amount_minor, line.book_minor, line.parallel_minor) THEN
    RAISE EXCEPTION 'open_item_movements: a movement is its line''s, on its line''s item'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (
    (item.kind = 'document' AND NEW.kind IN ('open', 'clear', 'revaluation'))
    OR (item.kind = 'running' AND NEW.kind IN ('add', 'clear', 'difference', 'revaluation'))
  ) OR line.kind IS DISTINCT FROM (CASE NEW.kind
      WHEN 'open' THEN 'measured' WHEN 'add' THEN 'measured'
      WHEN 'clear' THEN 'carried' WHEN 'difference' THEN 'difference'
      WHEN 'revaluation' THEN 'difference' END)
    OR (NEW.kind = 'revaluation') IS DISTINCT FROM (entry.source = 'revaluation')
    OR (NEW.kind = 'revaluation' AND NEW.amount_minor <> 0) THEN
    RAISE EXCEPTION 'open_item_movements: a % movement does not fit a % item on a % line of a % entry',
      NEW.kind, item.kind, line.kind, entry.source
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.kind = 'open' AND NOT (
    (NEW.entry_id = item.opened_by_entry_id AND NOT EXISTS (
      SELECT 1 FROM public.open_item_movements m
      WHERE m.company_id = NEW.company_id AND m.item_id = NEW.item_id
        AND m.entry_id = NEW.entry_id AND m.kind = 'open'))
    OR entry.reverses_entry_id IS NOT DISTINCT FROM item.opened_by_entry_id
  ) THEN
    RAISE EXCEPTION 'open_item_movements: item % opens once, in the entry that opened it', NEW.item_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.kind = 'open' AND entry.reverses_entry_id IS NULL AND sign(NEW.amount_minor) <> (
    SELECT CASE a.normal_balance WHEN 'debit' THEN 1 ELSE -1 END
    FROM public.chart_accounts a
    WHERE a.company_id = NEW.company_id AND a.id = item.account_id
  ) THEN
    RAISE EXCEPTION 'open_item_movements: OPEN_ITEM_DIRECTION: item % opens against its account''s normal balance', NEW.item_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.adjusted IS DISTINCT FROM (entry.source = 'manual' AND item.source <> 'manual'
      AND NOT (item.source = 'opening' AND item.hub_document IS NULL)) THEN
    RAISE EXCEPTION 'open_item_movements: adjusted exactly when a manual entry moves a % item',
      item.source
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.kind = 'open' AND entry.reverses_entry_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.open_item_movements m
    JOIN public.journal_entries e ON e.company_id = m.company_id AND e.id = m.entry_id
    WHERE m.company_id = NEW.company_id AND m.item_id = NEW.item_id AND m.kind <> 'open'
      AND e.reverses_entry_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries r
        WHERE r.company_id = m.company_id AND r.reverses_entry_id = m.entry_id
      )
  ) THEN
    RAISE EXCEPTION 'open_item_movements: OPEN_ITEM_HAS_SETTLEMENTS: item % has movements its opening''s reversal would leave', NEW.item_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
