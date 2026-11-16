-- S12 PR 1 (ADR 0023): project documents, materials and quantities, and the application of advances.
-- - `materials`, `project_terms`, `project_budgets` and `subcontracts` are business data: the app
--   role reads, adds and changes them, never deletes them (archived instead). A material's unit is
--   locked once a posted line names it; a project's terms are of a contract value of kind
--   `project`; a budget is on a postable direct-cost account; a subcontract pairs a project and a
--   supplier; the currencies are locked once a billing posted.
-- - `project_documents`, `line_quantities` and `advance_applications` are append-only, written
--   only by the posting function in the posting transaction; `project_document_sequences` is ledger
--   state: made at 1, moved by one, every number taken by a document by commit (gapless).
-- - A line's quantity holds its amount to the rounded product of quantity and unit price, its
--   material to its account's requirement, and a reversal's to the negation of its original's; every
--   line on an account that requires a material has its quantity by commit.
-- - An advance application ties a covered line to the clearing line of the same entry; the covered
--   parts of a clearing line equal it in every amount by commit (IFRIC 22.8).
-- - `chart_accounts.requires_material` joins the lock after first use, and is set on `511001` of
--   every company made from `contracting@1` that has not used it yet.
-- - A project document draft's header is read only once submitted, and the draft posts only with
--   its document.
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE materials FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON materials
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE project_terms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_terms FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON project_terms
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE project_budgets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_budgets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON project_budgets
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE subcontracts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE subcontracts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON subcontracts
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE project_document_sequences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_document_sequences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON project_document_sequences
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON project_documents
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE line_quantities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE line_quantities FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON line_quantities
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE advance_applications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE advance_applications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON advance_applications
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
REVOKE ALL ON materials, project_terms, project_budgets, subcontracts, project_document_sequences,
  project_documents, line_quantities, advance_applications FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON materials, project_terms, project_budgets, subcontracts,
  project_document_sequences TO mizan_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON project_documents, line_quantities, advance_applications TO mizan_app;
--> statement-breakpoint
CREATE TRIGGER materials_refuse_delete BEFORE DELETE ON materials
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER materials_refuse_truncate BEFORE TRUNCATE ON materials
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE materials ENABLE ALWAYS TRIGGER materials_refuse_delete;
--> statement-breakpoint
ALTER TABLE materials ENABLE ALWAYS TRIGGER materials_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER project_terms_refuse_delete BEFORE DELETE ON project_terms
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER project_terms_refuse_truncate BEFORE TRUNCATE ON project_terms
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE project_terms ENABLE ALWAYS TRIGGER project_terms_refuse_delete;
--> statement-breakpoint
ALTER TABLE project_terms ENABLE ALWAYS TRIGGER project_terms_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER project_budgets_refuse_delete BEFORE DELETE ON project_budgets
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER project_budgets_refuse_truncate BEFORE TRUNCATE ON project_budgets
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE project_budgets ENABLE ALWAYS TRIGGER project_budgets_refuse_delete;
--> statement-breakpoint
ALTER TABLE project_budgets ENABLE ALWAYS TRIGGER project_budgets_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER subcontracts_refuse_delete BEFORE DELETE ON subcontracts
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER subcontracts_refuse_truncate BEFORE TRUNCATE ON subcontracts
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE subcontracts ENABLE ALWAYS TRIGGER subcontracts_refuse_delete;
--> statement-breakpoint
ALTER TABLE subcontracts ENABLE ALWAYS TRIGGER subcontracts_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER project_document_sequences_refuse_delete BEFORE DELETE ON project_document_sequences
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER project_document_sequences_refuse_truncate BEFORE TRUNCATE
  ON project_document_sequences
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE project_document_sequences
  ENABLE ALWAYS TRIGGER project_document_sequences_refuse_delete;
--> statement-breakpoint
ALTER TABLE project_document_sequences
  ENABLE ALWAYS TRIGGER project_document_sequences_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER project_documents_refuse_change BEFORE UPDATE OR DELETE ON project_documents
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER project_documents_refuse_truncate BEFORE TRUNCATE ON project_documents
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE project_documents ENABLE ALWAYS TRIGGER project_documents_refuse_change;
--> statement-breakpoint
ALTER TABLE project_documents ENABLE ALWAYS TRIGGER project_documents_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER line_quantities_refuse_change BEFORE UPDATE OR DELETE ON line_quantities
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER line_quantities_refuse_truncate BEFORE TRUNCATE ON line_quantities
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE line_quantities ENABLE ALWAYS TRIGGER line_quantities_refuse_change;
--> statement-breakpoint
ALTER TABLE line_quantities ENABLE ALWAYS TRIGGER line_quantities_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER advance_applications_refuse_change BEFORE UPDATE OR DELETE ON advance_applications
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER advance_applications_refuse_truncate BEFORE TRUNCATE ON advance_applications
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE advance_applications ENABLE ALWAYS TRIGGER advance_applications_refuse_change;
--> statement-breakpoint
ALTER TABLE advance_applications ENABLE ALWAYS TRIGGER advance_applications_refuse_truncate;
--> statement-breakpoint
-- The exponent of a currency's minor unit (ADR 0007), as the money module's table states it; a
-- test keeps them equal. Null for a code the table does not hold.
CREATE FUNCTION currency_exponent(code text) RETURNS integer
  LANGUAGE sql IMMUTABLE
  AS $$
  SELECT CASE code WHEN 'USD' THEN 2 WHEN 'SYP' THEN 2 WHEN 'TRY' THEN 2 WHEN 'EUR' THEN 2 END
$$;
--> statement-breakpoint
-- A material (S12 rule 3): its identity never changes, and its unit is locked once a posted line
-- names it.
CREATE FUNCTION material_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.id, NEW.company_id, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.created_at)
  THEN
    RAISE EXCEPTION 'materials: a material keeps its id and company'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.unit IS DISTINCT FROM OLD.unit AND EXISTS (
    SELECT 1 FROM public.line_quantities q
    WHERE q.company_id = OLD.company_id AND q.material_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'materials: the unit of material % is locked since its first use', OLD.code
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER material_rules BEFORE UPDATE ON materials
  FOR EACH ROW EXECUTE FUNCTION material_rules();
--> statement-breakpoint
ALTER TABLE materials ENABLE ALWAYS TRIGGER material_rules;
--> statement-breakpoint
-- A project's terms (S12 rule 1): of a value of the built-in `contract` dimension of kind
-- `project`, which they keep; the currency locked once a progress billing of the project posted.
CREATE FUNCTION project_terms_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.company_id, NEW.contract_value_id, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.contract_value_id, OLD.created_at) THEN
      RAISE EXCEPTION 'project_terms: the terms keep their project'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.currency IS DISTINCT FROM OLD.currency AND EXISTS (
      SELECT 1 FROM public.project_documents d
      WHERE d.company_id = OLD.company_id AND d.contract_value_id = OLD.contract_value_id
        AND d.kind = 'progress_billing'
    ) THEN
      RAISE EXCEPTION 'project_terms: the currency is locked since the project''s first billing'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.dimension_values v
    JOIN public.dimension_types t ON t.company_id = v.company_id AND t.id = v.type_id
    WHERE v.company_id = NEW.company_id AND v.id = NEW.contract_value_id
      AND t.builtin AND t.code = 'contract' AND v.contract_kind = 'project'
  ) THEN
    RAISE EXCEPTION 'project_terms: terms are of a contract value of kind project'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER project_terms_rules BEFORE INSERT OR UPDATE ON project_terms
  FOR EACH ROW EXECUTE FUNCTION project_terms_rules();
--> statement-breakpoint
ALTER TABLE project_terms ENABLE ALWAYS TRIGGER project_terms_rules;
--> statement-breakpoint
-- A budget line (S12 "Data"): of its project and account for good, on a postable account of the
-- statement line `is.direct_costs`.
CREATE FUNCTION project_budget_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.company_id, NEW.contract_value_id, NEW.account_id,
      NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.contract_value_id, OLD.account_id, OLD.created_at)
  THEN
    RAISE EXCEPTION 'project_budgets: a budget line keeps its project and account'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chart_accounts a
    WHERE a.company_id = NEW.company_id AND a.id = NEW.account_id
      AND a.kind = 'postable' AND a.statement_line = 'is.direct_costs'
  ) THEN
    RAISE EXCEPTION 'project_budgets: a budget is on a postable direct-cost account'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER project_budget_rules BEFORE INSERT OR UPDATE ON project_budgets
  FOR EACH ROW EXECUTE FUNCTION project_budget_rules();
--> statement-breakpoint
ALTER TABLE project_budgets ENABLE ALWAYS TRIGGER project_budget_rules;
--> statement-breakpoint
-- A subcontract (S12 rule 2): a project (a contract value of kind `project`) and a supplier (a
-- value of the built-in `supplier` type), which it keeps; its currency locked once a subcontract
-- billing of that supplier on that project posted.
CREATE FUNCTION subcontract_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.company_id, NEW.contract_value_id, NEW.supplier_value_id, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.contract_value_id, OLD.supplier_value_id,
        OLD.created_at) THEN
      RAISE EXCEPTION 'subcontracts: a subcontract keeps its project and supplier'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.currency IS DISTINCT FROM OLD.currency AND EXISTS (
      SELECT 1 FROM public.project_documents d
      WHERE d.company_id = OLD.company_id AND d.contract_value_id = OLD.contract_value_id
        AND d.counterparty_value_id = OLD.supplier_value_id AND d.kind = 'subcontract_billing'
    ) THEN
      RAISE EXCEPTION 'subcontracts: the currency is locked since the subcontract''s first billing'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.dimension_values v
    JOIN public.dimension_types t ON t.company_id = v.company_id AND t.id = v.type_id
    WHERE v.company_id = NEW.company_id AND v.id = NEW.contract_value_id
      AND t.builtin AND t.code = 'contract' AND v.contract_kind = 'project'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.dimension_values v
    JOIN public.dimension_types t ON t.company_id = v.company_id AND t.id = v.type_id
    WHERE v.company_id = NEW.company_id AND v.id = NEW.supplier_value_id
      AND t.builtin AND t.code = 'supplier'
  ) THEN
    RAISE EXCEPTION 'subcontracts: a subcontract pairs a project and a supplier'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER subcontract_rules BEFORE INSERT OR UPDATE ON subcontracts
  FOR EACH ROW EXECUTE FUNCTION subcontract_rules();
--> statement-breakpoint
ALTER TABLE subcontracts ENABLE ALWAYS TRIGGER subcontract_rules;
--> statement-breakpoint
-- A kind's numbers in a fiscal year start at 1 and move by one at a time (S12 rule 21).
CREATE FUNCTION project_document_sequence_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.last_number <> 1 THEN
      RAISE EXCEPTION 'project_document_sequences: a kind''s numbers in a fiscal year start at 1'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.kind, NEW.fiscal_year, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.kind, OLD.fiscal_year, OLD.created_at)
    OR NEW.last_number IS DISTINCT FROM OLD.last_number + 1 THEN
    RAISE EXCEPTION 'project_document_sequences: a sequence moves by one number at a time'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER project_document_sequence_rules BEFORE INSERT OR UPDATE
  ON project_document_sequences
  FOR EACH ROW EXECUTE FUNCTION project_document_sequence_rules();
--> statement-breakpoint
ALTER TABLE project_document_sequences ENABLE ALWAYS TRIGGER project_document_sequence_rules;
--> statement-breakpoint
-- Every number a sequence gives is taken by a document of its kind and fiscal year by commit, so no
-- number is skipped. Deferred: the document is inserted after its sequence moves.
CREATE FUNCTION project_document_sequence_used() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.project_documents d
    WHERE d.company_id = NEW.company_id AND d.kind = NEW.kind
      AND d.fiscal_year = NEW.fiscal_year AND d.number = NEW.last_number
  ) THEN
    RAISE EXCEPTION '% document number % of fiscal year % was given but no document took it',
      NEW.kind, NEW.last_number, NEW.fiscal_year
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER project_document_sequence_used AFTER INSERT OR UPDATE
  ON project_document_sequences DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION project_document_sequence_used();
--> statement-breakpoint
ALTER TABLE project_document_sequences ENABLE ALWAYS TRIGGER project_document_sequence_used;
--> statement-breakpoint
-- A project document (S12 rule 21): of its own draft, a project document draft being posted with the
-- same kind, date, project, counterparty, side, period and supplier's reference (and currency, for
-- a purchase or a wage sheet); with the number its kind's sequence for the fiscal year just gave;
-- and with its entry, posted from that draft on its date in its fiscal year, reversing nothing.
CREATE FUNCTION project_document_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  draft record;
  given integer;
  entry record;
BEGIN
  SELECT d.state, d.archived_at, d.entry_date, d.project_document_kind, d.contract_value_id,
    d.counterparty_value_id, d.side, d.period_from, d.period_to, d.supplier_reference,
    d.document_currency
  INTO draft
  FROM public.entry_drafts d
  WHERE d.company_id = NEW.company_id AND d.id = NEW.draft_id
  FOR SHARE;
  IF NOT FOUND OR draft.state = 'posted' OR draft.archived_at IS NOT NULL
    OR draft.project_document_kind IS DISTINCT FROM NEW.kind
    OR draft.entry_date IS DISTINCT FROM NEW.document_date
    OR (draft.contract_value_id, draft.counterparty_value_id, draft.side, draft.period_from,
      draft.period_to, draft.supplier_reference)
      IS DISTINCT FROM (NEW.contract_value_id, NEW.counterparty_value_id, NEW.side,
        NEW.period_from, NEW.period_to, NEW.supplier_reference)
    OR (draft.document_currency IS NOT NULL AND draft.document_currency <> NEW.currency) THEN
    RAISE EXCEPTION 'project_documents: a document is its own project document draft''s, as prepared'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT s.last_number INTO given
  FROM public.project_document_sequences s
  WHERE s.company_id = NEW.company_id AND s.kind = NEW.kind AND s.fiscal_year = NEW.fiscal_year;
  IF given IS DISTINCT FROM NEW.number THEN
    RAISE EXCEPTION 'project_documents: a document takes the number its sequence just gave'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT e.draft_id, e.entry_date, e.fiscal_year, e.source, e.reverses_entry_id INTO entry
  FROM public.journal_entries e
  WHERE e.company_id = NEW.company_id AND e.id = NEW.entry_id;
  IF NOT FOUND OR entry.draft_id IS DISTINCT FROM NEW.draft_id
    OR entry.entry_date <> NEW.document_date OR entry.fiscal_year <> NEW.fiscal_year
    OR entry.source <> 'manual' OR entry.reverses_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'project_documents: a document''s entry is posted from its draft, on its date'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER project_document_rules BEFORE INSERT ON project_documents
  FOR EACH ROW EXECUTE FUNCTION project_document_rules();
--> statement-breakpoint
ALTER TABLE project_documents ENABLE ALWAYS TRIGGER project_document_rules;
--> statement-breakpoint
-- A line's quantity (S12 rules 4–6, 22): on a measured line of the entry being posted, of that
-- entry; a material exactly when the line's account requires one, in the material's unit; with a
-- quantity other than 0, the line's amount the product of quantity and unit price, rounded half
-- away from zero to the currency's minor unit; on a reversal's line, the negation of its original
-- line's quantity, with the same material, unit and unit price.
CREATE FUNCTION line_quantity_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  line record;
  material_unit text;
  original record;
BEGIN
  SELECT l.entry_id, l.line_no, l.kind, l.currency, l.amount_minor, a.requires_material,
    e.sequence, e.reverses_entry_id, h.entry_count
  INTO line
  FROM public.journal_lines l
  JOIN public.journal_entries e ON e.company_id = l.company_id AND e.id = l.entry_id
  JOIN public.ledger_heads h ON h.company_id = e.company_id
  JOIN public.chart_accounts a ON a.company_id = l.company_id AND a.id = l.account_id
  WHERE l.company_id = NEW.company_id AND l.id = NEW.line_id;
  IF NOT FOUND OR line.entry_id <> NEW.entry_id OR line.kind <> 'measured'
    OR line.sequence <> line.entry_count + 1 THEN
    RAISE EXCEPTION 'line_quantities: a quantity is added only to a measured line of the entry being posted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.material_id IS NOT NULL) <> line.requires_material THEN
    RAISE EXCEPTION 'line_quantities: a line names a material exactly when its account requires one'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.material_id IS NOT NULL THEN
    SELECT m.unit INTO material_unit
    FROM public.materials m
    WHERE m.company_id = NEW.company_id AND m.id = NEW.material_id;
    IF material_unit IS DISTINCT FROM NEW.unit THEN
      RAISE EXCEPTION 'line_quantities: a material''s line is in the material''s unit'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW.quantity <> 0 AND line.amount_minor
    <> round(NEW.quantity * NEW.unit_price * power(10::numeric, public.currency_exponent(line.currency)))
  THEN
    RAISE EXCEPTION 'line_quantities: a line''s amount is its quantity times its unit price, rounded'
      USING ERRCODE = 'check_violation';
  END IF;
  IF line.reverses_entry_id IS NOT NULL THEN
    SELECT q.material_id, q.unit, q.quantity, q.unit_price INTO original
    FROM public.journal_lines o
    JOIN public.line_quantities q ON q.company_id = o.company_id AND q.line_id = o.id
    WHERE o.company_id = NEW.company_id AND o.entry_id = line.reverses_entry_id
      AND o.line_no = line.line_no;
    IF NOT FOUND OR (original.material_id, original.unit, -original.quantity, original.unit_price)
      IS DISTINCT FROM (NEW.material_id, NEW.unit, NEW.quantity, NEW.unit_price) THEN
      RAISE EXCEPTION 'line_quantities: a reversal''s line carries its original''s quantity negated'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER line_quantity_rules BEFORE INSERT ON line_quantities
  FOR EACH ROW EXECUTE FUNCTION line_quantity_rules();
--> statement-breakpoint
ALTER TABLE line_quantities ENABLE ALWAYS TRIGGER line_quantity_rules;
--> statement-breakpoint
-- S12 rule 4: every line on an account that requires a material, but a difference or rounding
-- line, has its quantity by commit; and a reversal's line has one exactly when its original has.
-- Deferred: the quantities are written after the lines.
CREATE FUNCTION journal_line_quantity_required() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  line record;
BEGIN
  SELECT l.kind, l.line_no, e.reverses_entry_id, a.requires_material,
    EXISTS (SELECT 1 FROM public.line_quantities q
      WHERE q.company_id = l.company_id AND q.line_id = l.id) AS has_quantity
  INTO line
  FROM public.journal_lines l
  JOIN public.journal_entries e ON e.company_id = l.company_id AND e.id = l.entry_id
  JOIN public.chart_accounts a ON a.company_id = l.company_id AND a.id = l.account_id
  WHERE l.company_id = NEW.company_id AND l.id = NEW.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal_lines: line % cannot be checked for its quantity', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF line.reverses_entry_id IS NOT NULL THEN
    IF line.has_quantity <> EXISTS (
      SELECT 1 FROM public.journal_lines o
      JOIN public.line_quantities q ON q.company_id = o.company_id AND q.line_id = o.id
      WHERE o.company_id = NEW.company_id AND o.entry_id = line.reverses_entry_id
        AND o.line_no = line.line_no
    ) THEN
      RAISE EXCEPTION 'journal_lines: a reversal''s line has a quantity exactly when its original has'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF line.requires_material AND line.kind NOT IN ('difference', 'rounding')
    AND NOT line.has_quantity THEN
    RAISE EXCEPTION 'journal_lines: a line on an account that requires a material names one and its quantity'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_quantity_required AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_line_quantity_required();
--> statement-breakpoint
ALTER TABLE journal_lines ENABLE ALWAYS TRIGGER journal_lines_quantity_required;
--> statement-breakpoint
-- An advance application (S12 rule 12, IFRIC 22.8): both lines of its entry, the entry being posted,
-- in one currency; the advance line moves a running item and the covered line is a measured line
-- that moves none; the covered part has the covered line's sign, at most its amount, and the
-- opposite sign to the advance line.
CREATE FUNCTION advance_application_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  advance record;
  covered record;
BEGIN
  SELECT l.entry_id, l.currency, l.amount_minor, e.sequence, h.entry_count INTO advance
  FROM public.journal_lines l
  JOIN public.journal_entries e ON e.company_id = l.company_id AND e.id = l.entry_id
  JOIN public.ledger_heads h ON h.company_id = e.company_id
  WHERE l.company_id = NEW.company_id AND l.id = NEW.advance_line_id;
  SELECT l.entry_id, l.currency, l.amount_minor, l.kind INTO covered
  FROM public.journal_lines l
  WHERE l.company_id = NEW.company_id AND l.id = NEW.line_id;
  IF advance.entry_id IS NULL OR covered.entry_id IS NULL
    OR advance.entry_id <> NEW.entry_id OR covered.entry_id <> NEW.entry_id
    OR advance.sequence <> advance.entry_count + 1 THEN
    RAISE EXCEPTION 'advance_applications: an application ties two lines of the entry being posted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF advance.currency <> covered.currency OR covered.kind <> 'measured'
    OR NOT EXISTS (
      SELECT 1 FROM public.open_item_movements m
      JOIN public.open_items i ON i.company_id = m.company_id AND i.id = m.item_id
      WHERE m.company_id = NEW.company_id AND m.line_id = NEW.advance_line_id
        AND i.kind = 'running'
    )
    OR EXISTS (
      SELECT 1 FROM public.open_item_movements m
      WHERE m.company_id = NEW.company_id AND m.line_id = NEW.line_id
    ) THEN
    RAISE EXCEPTION 'advance_applications: an advance''s running item covers a measured line of its currency'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF sign(NEW.amount_minor) <> sign(covered.amount_minor)
    OR abs(NEW.amount_minor) > abs(covered.amount_minor)
    OR sign(NEW.amount_minor) = sign(advance.amount_minor) THEN
    RAISE EXCEPTION 'advance_applications: a covered part within its line, against its advance'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER advance_application_rules BEFORE INSERT ON advance_applications
  FOR EACH ROW EXECUTE FUNCTION advance_application_rules();
--> statement-breakpoint
ALTER TABLE advance_applications ENABLE ALWAYS TRIGGER advance_application_rules;
--> statement-breakpoint
-- The covered parts of a clearing line sum to the negation of that line's amounts in every ledger
-- (S12 rule 12): the advance leaves no exchange difference. Deferred, over all of the line's
-- applications; `sum()` skips nulls, so the parallel amounts are counted apart.
CREATE FUNCTION advance_applications_agree() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  advance record;
  parts record;
BEGIN
  SELECT l.amount_minor, l.book_minor, l.parallel_minor INTO advance
  FROM public.journal_lines l
  WHERE l.company_id = NEW.company_id AND l.id = NEW.advance_line_id;
  SELECT sum(a.amount_minor) AS amount, sum(a.book_minor) AS book,
    sum(a.parallel_minor) AS parallel, count(*) FILTER (WHERE a.parallel_minor IS NULL) AS no_parallel,
    count(*) AS applications
  INTO parts
  FROM public.advance_applications a
  WHERE a.company_id = NEW.company_id AND a.advance_line_id = NEW.advance_line_id;
  IF advance.amount_minor IS NULL OR parts.amount <> -advance.amount_minor
    OR parts.book <> -advance.book_minor
    OR (advance.parallel_minor IS NULL) <> (parts.no_parallel = parts.applications)
    OR (advance.parallel_minor IS NOT NULL
      AND (parts.no_parallel <> 0 OR parts.parallel <> -advance.parallel_minor)) THEN
    RAISE EXCEPTION 'advance_applications: the covered parts of line % do not equal it', NEW.advance_line_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER advance_applications_agree AFTER INSERT ON advance_applications
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION advance_applications_agree();
--> statement-breakpoint
ALTER TABLE advance_applications ENABLE ALWAYS TRIGGER advance_applications_agree;
--> statement-breakpoint
-- The lock after first use (S02 rule 5, 0063) covers `requires_material` (S12 "The chart").
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
          NEW.requires_material, NEW.is_monetary)
          IS DISTINCT FROM (OLD.code, OLD.parent_id, OLD.level, OLD.kind, OLD.class,
            OLD.normal_balance, OLD.currency, OLD.is_control, OLD.item_kind,
            OLD.counterparty_type, OLD.cash_kind, OLD.requires_material, OLD.is_monetary)
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
-- A draft (S03 rules 4–11, S11 rule 9, S12 rule 21): as `0068`, with a project document's header
-- read only once submitted, and a project document draft posted only with its document.
CREATE OR REPLACE FUNCTION entry_draft_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' OR NEW.archived_at IS NOT NULL OR NEW.submitted_by_user_id IS NOT NULL
      OR NEW.rejected_by_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'entry_drafts: a draft starts unsubmitted, in the draft state'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'posted' OR OLD.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'entry_drafts: draft % is posted or discarded and never changes', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.company_id, NEW.prepared_by_user_id, NEW.reverses_entry_id,
      NEW.copied_from_entry_id, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.prepared_by_user_id, OLD.reverses_entry_id,
      OLD.copied_from_entry_id, OLD.created_at) THEN
    RAISE EXCEPTION 'entry_drafts: the identity, preparer and origin of draft % never change',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.state = 'submitted'
    AND (NEW.entry_date, NEW.description, NEW.reference, NEW.dealt_rates, NEW.archived_at,
      NEW.voucher_kind, NEW.cash_account_id, NEW.counter_cash_account_id, NEW.party_name,
      NEW.counted_minor, NEW.project_document_kind, NEW.contract_value_id,
      NEW.counterparty_value_id, NEW.document_currency, NEW.side, NEW.period_from, NEW.period_to,
      NEW.cumulative_minor, NEW.retention_minor, NEW.advance_minor, NEW.supplier_reference)
      IS DISTINCT FROM (OLD.entry_date, OLD.description, OLD.reference, OLD.dealt_rates,
        OLD.archived_at, OLD.voucher_kind, OLD.cash_account_id, OLD.counter_cash_account_id,
        OLD.party_name, OLD.counted_minor, OLD.project_document_kind, OLD.contract_value_id,
        OLD.counterparty_value_id, OLD.document_currency, OLD.side, OLD.period_from,
        OLD.period_to, OLD.cumulative_minor, OLD.retention_minor, OLD.advance_minor,
        OLD.supplier_reference) THEN
    RAISE EXCEPTION 'entry_drafts: draft % is submitted and read only', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.state = 'posted' AND NEW.voucher_kind IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cash_vouchers v
    WHERE v.company_id = NEW.company_id AND v.draft_id = NEW.id
      AND v.entry_id IS NOT DISTINCT FROM NEW.posted_entry_id
  ) THEN
    RAISE EXCEPTION 'entry_drafts: voucher draft % posts only with its voucher', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.state = 'posted' AND NEW.project_document_kind IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.project_documents p
    WHERE p.company_id = NEW.company_id AND p.draft_id = NEW.id
      AND p.entry_id = NEW.posted_entry_id
  ) THEN
    RAISE EXCEPTION 'entry_drafts: project document draft % posts only with its document', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.state = 'posted' AND NEW.posted_entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.company_id = NEW.company_id AND e.id = NEW.posted_entry_id AND e.draft_id = NEW.id
      AND e.source = 'manual'
      AND e.prepared_by_user_id = NEW.prepared_by_user_id
      AND e.reverses_entry_id IS NOT DISTINCT FROM NEW.reverses_entry_id
      AND (CASE WHEN OLD.state = 'draft' THEN e.approved_by_user_id IS NULL
        ELSE e.approved_by_user_id IS NOT NULL
          AND e.approved_by_user_id <> OLD.prepared_by_user_id
          AND e.approved_by_user_id <> OLD.submitted_by_user_id END)
  ) THEN
    RAISE EXCEPTION 'entry_drafts: draft % posts only as its own entry, approved by another person',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- `contracting@1`'s `511001` requires a material (S12 "The chart"; owner, 2026-11-16: the
-- template's version stays 1). Set per company context, on the account that template made (its
-- name and statement line), only while unused: an account used before is locked (S02 rule 5) and
-- its lines have no quantities. The general chart's `511001` is another account and stays as it is.
DO $$
DECLARE
  company record;
BEGIN
  FOR company IN SELECT c.id FROM public.companies c LOOP
    PERFORM set_config('app.company_id', company.id::text, true);
    UPDATE public.chart_accounts a
    SET requires_material = true
    WHERE a.code = '511001' AND a.name = 'المواد' AND a.kind = 'postable'
      AND a.statement_line = 'is.direct_costs' AND a.first_posted_at IS NULL
      AND NOT a.requires_material;
  END LOOP;
  PERFORM set_config('app.company_id', '', true);
END
$$;
