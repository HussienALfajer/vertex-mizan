-- S12 PR 2 (rules 14–22): a project document's guard for billings and retention releases, and the
-- cancellation order of billings. Replaced in place with its new pin (`test/conventions.ts`):
-- - `project_document_rules()`: a progress billing's and a client's release's counterparty is the
--   project's client, which their draft does not name; a billing's cumulative, and its deductions
--   where the accountant typed them, are its draft's, a supplier's release's amount too; a billing
--   takes the next number within its project or subcontract, its previous is the cumulative of the
--   latest uncancelled billing there, and it is dated on or after that billing (the ledger head
--   locked first, so two billings of one project serialise);
-- - `journal_entry_billing_order()` (new): a billing's entry is reversed only while no later
--   billing of its project or subcontract stands (`PROJECT_DOCUMENT_NOT_LATEST` in `post()`).
CREATE OR REPLACE FUNCTION project_document_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  draft record;
  given integer;
  entry record;
  client uuid;
  latest record;
  next_sequence integer;
BEGIN
  SELECT d.state, d.archived_at, d.entry_date, d.project_document_kind, d.contract_value_id,
    d.counterparty_value_id, d.side, d.period_from, d.period_to, d.supplier_reference,
    d.document_currency, d.cumulative_minor, d.retention_minor, d.advance_minor
  INTO draft
  FROM public.entry_drafts d
  WHERE d.company_id = NEW.company_id AND d.id = NEW.draft_id
  FOR SHARE;
  -- A progress billing and a client's release name the project's client as their counterparty.
  SELECT v.parent_value_id INTO client
  FROM public.dimension_values v
  WHERE v.company_id = NEW.company_id AND v.id = NEW.contract_value_id;
  IF NOT FOUND OR draft.state = 'posted' OR draft.archived_at IS NOT NULL
    OR draft.project_document_kind IS DISTINCT FROM NEW.kind
    OR draft.entry_date IS DISTINCT FROM NEW.document_date
    OR (draft.contract_value_id, draft.side, draft.period_from, draft.period_to,
      draft.supplier_reference)
      IS DISTINCT FROM (NEW.contract_value_id, NEW.side, NEW.period_from, NEW.period_to,
        NEW.supplier_reference)
    OR (CASE
      WHEN NEW.kind = 'progress_billing'
        OR (NEW.kind = 'retention_release' AND NEW.side = 'client')
        THEN draft.counterparty_value_id IS NOT NULL OR client IS NULL
          OR NEW.counterparty_value_id IS DISTINCT FROM client
      ELSE draft.counterparty_value_id IS DISTINCT FROM NEW.counterparty_value_id
    END)
    OR (draft.document_currency IS NOT NULL AND draft.document_currency <> NEW.currency)
    OR (NEW.cumulative_minor IS NOT NULL AND NEW.cumulative_minor IS DISTINCT FROM draft.cumulative_minor)
    OR (NEW.kind IN ('progress_billing', 'subcontract_billing')
      AND ((draft.retention_minor IS NOT NULL AND draft.retention_minor <> NEW.retention_minor)
        OR (draft.advance_minor IS NOT NULL AND draft.advance_minor <> NEW.advance_minor)))
    OR (NEW.kind = 'retention_release' AND NEW.side = 'supplier'
      AND draft.retention_minor IS DISTINCT FROM NEW.retention_minor) THEN
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
  -- A billing (S12 rules 14, 16): the next number within its project or subcontract, its previous
  -- the cumulative of the latest uncancelled billing there, dated on or after it. The ledger head,
  -- locked first, serialises two billings of one project.
  IF NEW.kind IN ('progress_billing', 'subcontract_billing') THEN
    PERFORM 1 FROM public.ledger_heads h WHERE h.company_id = NEW.company_id FOR UPDATE;
    SELECT coalesce(max(d.project_sequence), 0) + 1 INTO next_sequence
    FROM public.project_documents d
    WHERE d.company_id = NEW.company_id AND d.kind = NEW.kind
      AND d.contract_value_id = NEW.contract_value_id
      AND d.counterparty_value_id = NEW.counterparty_value_id;
    SELECT d.cumulative_minor, d.document_date INTO latest
    FROM public.project_documents d
    WHERE d.company_id = NEW.company_id AND d.kind = NEW.kind
      AND d.contract_value_id = NEW.contract_value_id
      AND d.counterparty_value_id = NEW.counterparty_value_id
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries r
        WHERE r.company_id = d.company_id AND r.reverses_entry_id = d.entry_id)
    ORDER BY d.project_sequence DESC
    LIMIT 1;
    IF NEW.project_sequence IS DISTINCT FROM next_sequence
      OR NEW.previous_minor IS DISTINCT FROM coalesce(latest.cumulative_minor, 0)
      OR NEW.document_date < latest.document_date THEN
      RAISE EXCEPTION 'project_documents: a billing follows the latest billing of its project'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION journal_entry_billing_order() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.reverses_entry_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.project_documents d
    JOIN public.project_documents l ON l.company_id = d.company_id AND l.kind = d.kind
      AND l.contract_value_id = d.contract_value_id
      AND l.counterparty_value_id = d.counterparty_value_id
      AND l.project_sequence > d.project_sequence
    WHERE d.company_id = NEW.company_id AND d.entry_id = NEW.reverses_entry_id
      AND d.project_sequence IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries r
        WHERE r.company_id = l.company_id AND r.reverses_entry_id = l.entry_id)
  ) THEN
    RAISE EXCEPTION 'journal_entries: a billing is cancelled only while it is its project''s latest'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entry_billing_order BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entry_billing_order();
--> statement-breakpoint
ALTER TABLE journal_entries ENABLE ALWAYS TRIGGER journal_entry_billing_order;
