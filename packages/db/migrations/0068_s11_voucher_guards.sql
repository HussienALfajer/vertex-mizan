-- S11 PR 2 (rules 9–14): the cash vouchers and their numbers, written only by the posting function
-- in the posting transaction (ADR 0005 invariant 11), and the voucher drafts.
-- - `cash_vouchers` is append-only: the app role reads and adds; no role updates, deletes or
--   truncates. A voucher is of its own draft, with its draft's header, kind and date; of a cash
--   account (a box for a count); with its entry, posted from its draft in its fiscal year, or, for
--   a count that matched, none, in an open month; and with the number its sequence just gave.
-- - `voucher_sequences` is ledger state: made at 1, moved by one number at a time, never deleted;
--   every number it gives is taken by a voucher of its kind and fiscal year by commit (gapless).
-- - A draft's voucher header is read only once submitted, as its other fields; a voucher draft
--   posts only with its voucher, and a count that matched posts with its voucher alone.
ALTER TABLE voucher_sequences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE voucher_sequences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON voucher_sequences
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE cash_vouchers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cash_vouchers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON cash_vouchers
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
REVOKE ALL ON voucher_sequences, cash_vouchers FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON voucher_sequences TO mizan_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON cash_vouchers TO mizan_app;
--> statement-breakpoint
CREATE TRIGGER cash_vouchers_refuse_change BEFORE UPDATE OR DELETE ON cash_vouchers
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER cash_vouchers_refuse_truncate BEFORE TRUNCATE ON cash_vouchers
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE cash_vouchers ENABLE ALWAYS TRIGGER cash_vouchers_refuse_change;
--> statement-breakpoint
ALTER TABLE cash_vouchers ENABLE ALWAYS TRIGGER cash_vouchers_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER voucher_sequences_refuse_delete BEFORE DELETE ON voucher_sequences
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER voucher_sequences_refuse_truncate BEFORE TRUNCATE ON voucher_sequences
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE voucher_sequences ENABLE ALWAYS TRIGGER voucher_sequences_refuse_delete;
--> statement-breakpoint
ALTER TABLE voucher_sequences ENABLE ALWAYS TRIGGER voucher_sequences_refuse_truncate;
--> statement-breakpoint
-- A kind's numbers in a fiscal year start at 1 and move by one at a time (S11 rule 9).
CREATE FUNCTION voucher_sequence_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.last_number <> 1 THEN
      RAISE EXCEPTION 'voucher_sequences: a kind''s numbers in a fiscal year start at 1'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.kind, NEW.fiscal_year, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.kind, OLD.fiscal_year, OLD.created_at)
    OR NEW.last_number IS DISTINCT FROM OLD.last_number + 1 THEN
    RAISE EXCEPTION 'voucher_sequences: a sequence moves by one number at a time'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER voucher_sequence_rules BEFORE INSERT OR UPDATE ON voucher_sequences
  FOR EACH ROW EXECUTE FUNCTION voucher_sequence_rules();
--> statement-breakpoint
ALTER TABLE voucher_sequences ENABLE ALWAYS TRIGGER voucher_sequence_rules;
--> statement-breakpoint
-- Every number a sequence gives is taken by a voucher of its kind and fiscal year by commit, so no
-- number is skipped. Deferred: the voucher is inserted after its sequence moves.
CREATE FUNCTION voucher_sequence_used() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.cash_vouchers v
    WHERE v.company_id = NEW.company_id AND v.kind = NEW.kind
      AND v.fiscal_year = NEW.fiscal_year AND v.number = NEW.last_number
  ) THEN
    RAISE EXCEPTION '% voucher number % of fiscal year % was given but no voucher took it',
      NEW.kind, NEW.last_number, NEW.fiscal_year
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER voucher_sequence_used AFTER INSERT OR UPDATE
  ON voucher_sequences DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION voucher_sequence_used();
--> statement-breakpoint
ALTER TABLE voucher_sequences ENABLE ALWAYS TRIGGER voucher_sequence_used;
--> statement-breakpoint
-- A voucher (S11 rules 9–13): of its own draft, a voucher draft being posted with the same header,
-- kind and date; of a cash account, a box for a count, a transfer's destination a cash account too;
-- with the number its kind's sequence for the fiscal year just gave; and either with its entry,
-- posted from that draft on its date in its fiscal year and reversing nothing, or, for a count that
-- matched, with none, its fiscal year that of its month, made open by the posting.
CREATE FUNCTION cash_voucher_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  draft record;
  cash_kind_of text;
  counter_kind text;
  given integer;
  entry record;
  month record;
BEGIN
  SELECT d.state, d.archived_at, d.entry_date, d.voucher_kind, d.cash_account_id,
    d.counter_cash_account_id, d.party_name, d.counted_minor
  INTO draft
  FROM public.entry_drafts d
  WHERE d.company_id = NEW.company_id AND d.id = NEW.draft_id
  FOR SHARE;
  IF NOT FOUND OR draft.state = 'posted' OR draft.archived_at IS NOT NULL
    OR draft.voucher_kind IS DISTINCT FROM NEW.kind
    OR draft.entry_date IS DISTINCT FROM NEW.voucher_date
    OR (draft.cash_account_id, draft.counter_cash_account_id, draft.party_name)
      IS DISTINCT FROM (NEW.cash_account_id, NEW.counter_cash_account_id, NEW.party_name)
    OR draft.counted_minor IS DISTINCT FROM NEW.counted_minor THEN
    RAISE EXCEPTION 'cash_vouchers: a voucher is its own voucher draft''s, as prepared'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT a.cash_kind::text INTO cash_kind_of
  FROM public.chart_accounts a
  WHERE a.company_id = NEW.company_id AND a.id = NEW.cash_account_id;
  IF cash_kind_of IS NULL OR (NEW.kind = 'count' AND cash_kind_of <> 'box') THEN
    RAISE EXCEPTION 'cash_vouchers: a voucher is of a cash account, a count of a box'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.counter_cash_account_id IS NOT NULL THEN
    SELECT a.cash_kind::text INTO counter_kind
    FROM public.chart_accounts a
    WHERE a.company_id = NEW.company_id AND a.id = NEW.counter_cash_account_id;
    IF counter_kind IS NULL THEN
      RAISE EXCEPTION 'cash_vouchers: a transfer''s destination is a cash account'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  SELECT s.last_number INTO given
  FROM public.voucher_sequences s
  WHERE s.company_id = NEW.company_id AND s.kind = NEW.kind AND s.fiscal_year = NEW.fiscal_year;
  IF given IS DISTINCT FROM NEW.number THEN
    RAISE EXCEPTION 'cash_vouchers: a voucher takes the number its sequence just gave'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.entry_id IS NOT NULL THEN
    SELECT e.draft_id, e.entry_date, e.fiscal_year, e.source, e.reverses_entry_id INTO entry
    FROM public.journal_entries e
    WHERE e.company_id = NEW.company_id AND e.id = NEW.entry_id;
    IF NOT FOUND OR entry.draft_id IS DISTINCT FROM NEW.draft_id
      OR entry.entry_date <> NEW.voucher_date OR entry.fiscal_year <> NEW.fiscal_year
      OR entry.source <> 'manual' OR entry.reverses_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'cash_vouchers: a voucher''s entry is posted from its draft, on its date'
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    SELECT p.fiscal_year, p.state INTO month
    FROM public.periods p
    WHERE p.company_id = NEW.company_id AND p.period = to_char(NEW.voucher_date, 'YYYY-MM')
    FOR SHARE;
    IF NOT FOUND OR month.state = 'closed' OR month.fiscal_year <> NEW.fiscal_year THEN
      RAISE EXCEPTION 'cash_vouchers: a count with no entry is in an open month of its fiscal year'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER cash_voucher_rules BEFORE INSERT ON cash_vouchers
  FOR EACH ROW EXECUTE FUNCTION cash_voucher_rules();
--> statement-breakpoint
ALTER TABLE cash_vouchers ENABLE ALWAYS TRIGGER cash_voucher_rules;
--> statement-breakpoint
-- A draft (S03 rules 4–11, S11 rule 9): as `0015`, with the voucher header read only once
-- submitted, and a voucher draft posted only with its voucher: with its entry, or for a count that
-- matched with its voucher alone.
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
      NEW.counted_minor)
      IS DISTINCT FROM (OLD.entry_date, OLD.description, OLD.reference, OLD.dealt_rates,
        OLD.archived_at, OLD.voucher_kind, OLD.cash_account_id, OLD.counter_cash_account_id,
        OLD.party_name, OLD.counted_minor) THEN
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
