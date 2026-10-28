-- The guards and grants of S03's drafts module (0014), as packages/db/CLAUDE.md and the
-- /db-migration skill write them (ADR 0003, ADR 0005 "drafts are not ledger", ADR 0008):
-- - forced RLS with the one company_isolation policy on the three tables;
-- - SELECT, INSERT, UPDATE for the app role, never DELETE, and refuse_delete() for every role:
--   drafts are discarded (archived), lines removed from a draft are archived, attachments are
--   archived from a draft only;
-- - a draft starts in `draft`; a posted or discarded draft never changes; a submitted one is read
--   only, its state alone moving; it posts once, to an entry posted from it in this transaction,
--   approved by nobody who prepared or submitted it;
-- - a draft's lines change only while it is being prepared;
-- - an attachment is added to a draft being prepared or to a posted entry, 20 at most; it moves to
--   the entry its draft posted, or is archived from the draft; one of a posted entry never changes.
-- Every trigger is ENABLE ALWAYS (ADR 0008); every guard function is pinned in test/conventions.ts
-- and names its tables with the schema. Nothing is granted to mizan_jobs, mizan_queue or PUBLIC; no
-- function is SECURITY DEFINER.
ALTER TABLE entry_drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE entry_drafts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON entry_drafts
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE entry_draft_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE entry_draft_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON entry_draft_lines
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE entry_attachments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE entry_attachments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON entry_attachments
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
REVOKE ALL ON entry_drafts, entry_draft_lines, entry_attachments FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON entry_drafts, entry_draft_lines, entry_attachments TO mizan_app;
--> statement-breakpoint
-- Archived, never deleted: refuse_delete() before DELETE (row) and TRUNCATE (statement).
CREATE TRIGGER entry_drafts_refuse_delete BEFORE DELETE ON entry_drafts
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER entry_drafts_refuse_truncate BEFORE TRUNCATE ON entry_drafts
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE entry_drafts ENABLE ALWAYS TRIGGER entry_drafts_refuse_delete;
--> statement-breakpoint
ALTER TABLE entry_drafts ENABLE ALWAYS TRIGGER entry_drafts_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER entry_draft_lines_refuse_delete BEFORE DELETE ON entry_draft_lines
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER entry_draft_lines_refuse_truncate BEFORE TRUNCATE ON entry_draft_lines
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE entry_draft_lines ENABLE ALWAYS TRIGGER entry_draft_lines_refuse_delete;
--> statement-breakpoint
ALTER TABLE entry_draft_lines ENABLE ALWAYS TRIGGER entry_draft_lines_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER entry_attachments_refuse_delete BEFORE DELETE ON entry_attachments
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER entry_attachments_refuse_truncate BEFORE TRUNCATE ON entry_attachments
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE entry_attachments ENABLE ALWAYS TRIGGER entry_attachments_refuse_delete;
--> statement-breakpoint
ALTER TABLE entry_attachments ENABLE ALWAYS TRIGGER entry_attachments_refuse_truncate;
--> statement-breakpoint
-- A draft (S03 rules 4–11): made in `draft`, unsubmitted and unrejected. A posted or discarded
-- draft never changes; its identity, preparer and origin never change; a submitted draft is read
-- only. It becomes `posted` only with an entry posted from it: by its preparer, of its original
-- when it is a reversal, unapproved when posted from `draft`, and from `submitted` approved by
-- someone who neither prepared nor submitted it (S03 rule 8).
CREATE FUNCTION entry_draft_rules() RETURNS trigger
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
    AND (NEW.entry_date, NEW.description, NEW.reference, NEW.dealt_rates, NEW.archived_at)
      IS DISTINCT FROM (OLD.entry_date, OLD.description, OLD.reference, OLD.dealt_rates,
        OLD.archived_at) THEN
    RAISE EXCEPTION 'entry_drafts: draft % is submitted and read only', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.state = 'posted' AND NOT EXISTS (
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
CREATE TRIGGER entry_draft_rules BEFORE INSERT OR UPDATE ON entry_drafts
  FOR EACH ROW EXECUTE FUNCTION entry_draft_rules();
--> statement-breakpoint
ALTER TABLE entry_drafts ENABLE ALWAYS TRIGGER entry_draft_rules;
--> statement-breakpoint
-- A draft's line changes only while its draft is being prepared: in `draft`, not discarded, not a
-- reversal (whose lines are its original's). The draft is read FOR SHARE, so a line write waits
-- for a submission or a posting of the same draft, and is then refused. A line keeps its draft
-- and number.
CREATE FUNCTION entry_draft_line_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  draft record;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.company_id, NEW.draft_id, NEW.line_no, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.draft_id, OLD.line_no, OLD.created_at) THEN
    RAISE EXCEPTION 'entry_draft_lines: a line keeps its draft and number'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT d.state, d.archived_at, d.reverses_entry_id INTO draft
  FROM public.entry_drafts d
  WHERE d.company_id = NEW.company_id AND d.id = NEW.draft_id
  FOR SHARE;
  IF NOT FOUND OR draft.state <> 'draft' OR draft.archived_at IS NOT NULL
    OR draft.reverses_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'entry_draft_lines: the lines of draft % change only while it is prepared',
      NEW.draft_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER entry_draft_line_rules BEFORE INSERT OR UPDATE ON entry_draft_lines
  FOR EACH ROW EXECUTE FUNCTION entry_draft_line_rules();
--> statement-breakpoint
ALTER TABLE entry_draft_lines ENABLE ALWAYS TRIGGER entry_draft_line_rules;
--> statement-breakpoint
-- An attachment (S03 rule 17; owner, 2026-10-28):
-- - added to a draft being prepared (read FOR SHARE) or to a posted entry, never both, and never
--   past 20 unarchived files on either;
-- - its file and who added it never change;
-- - a draft's attachment either moves to the entry its draft posted, or is archived, once;
-- - an attachment of a posted entry never changes: it is never removed.
CREATE FUNCTION entry_attachment_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  draft record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.archived_at IS NOT NULL OR (NEW.draft_id IS NULL) = (NEW.entry_id IS NULL) THEN
      RAISE EXCEPTION 'entry_attachments: a file is added to a draft or to an entry'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.draft_id IS NOT NULL THEN
      SELECT d.state, d.archived_at INTO draft
      FROM public.entry_drafts d
      WHERE d.company_id = NEW.company_id AND d.id = NEW.draft_id
      FOR SHARE;
      IF NOT FOUND OR draft.state <> 'draft' OR draft.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'entry_attachments: files are added to draft % only while it is prepared',
          NEW.draft_id
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
    IF (SELECT count(*) FROM public.entry_attachments a
        WHERE a.company_id = NEW.company_id AND a.archived_at IS NULL
          AND (a.draft_id = NEW.draft_id OR a.entry_id = NEW.entry_id)) >= 20 THEN
      RAISE EXCEPTION 'entry_attachments: 20 files at most on a draft or an entry'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.draft_id, NEW.file_name, NEW.content_type, NEW.size_bytes,
      NEW.sha256, NEW.storage_key, NEW.uploaded_by_user_id, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.draft_id, OLD.file_name, OLD.content_type,
      OLD.size_bytes, OLD.sha256, OLD.storage_key, OLD.uploaded_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'entry_attachments: the file of attachment % never changes', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.entry_id IS NOT NULL OR OLD.archived_at IS NOT NULL THEN
    IF (NEW.entry_id, NEW.archived_at, NEW.archived_reason)
      IS DISTINCT FROM (OLD.entry_id, OLD.archived_at, OLD.archived_reason) THEN
      RAISE EXCEPTION 'entry_attachments: attachment % of a posted entry, or removed, never changes',
        OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.entry_id IS NOT NULL AND (NEW.archived_at IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM public.entry_drafts d
    WHERE d.company_id = NEW.company_id AND d.id = NEW.draft_id
      AND d.posted_entry_id = NEW.entry_id
  )) THEN
    RAISE EXCEPTION 'entry_attachments: attachment % moves only to the entry its draft posted',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER entry_attachment_rules BEFORE INSERT OR UPDATE ON entry_attachments
  FOR EACH ROW EXECUTE FUNCTION entry_attachment_rules();
--> statement-breakpoint
ALTER TABLE entry_attachments ENABLE ALWAYS TRIGGER entry_attachment_rules;
