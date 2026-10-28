-- Two guards the review of S03 PR 1 found missing, as 0012 writes its guards (ENABLE ALWAYS,
-- pinned in test/conventions.ts, tables named with their schema):
-- - a conversion is added only to a measured line of the entry being posted in this transaction,
--   never to a reversal's: otherwise a later transaction could add rate rows to a posted entry and
--   list it under a rate it never used (ADR 0005 invariants 2 and 11, S02 rule 15);
-- - a posting request has its entry when its transaction commits: otherwise a request inserted
--   alone would hold a draft's or an event's key, and its posting would be refused for good
--   (ADR 0005 invariant 5, S03 rules 2–3).

-- A conversion belongs to the entry the head is about to move to: the posting function inserts an
-- entry, its lines and their conversions before it moves the head, which it holds FOR UPDATE.
CREATE FUNCTION line_conversion_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  line record;
BEGIN
  SELECT l.kind, e.sequence, e.reverses_entry_id, h.entry_count INTO line
  FROM public.journal_lines l
  JOIN public.journal_entries e ON e.company_id = l.company_id AND e.id = l.entry_id
  JOIN public.ledger_heads h ON h.company_id = e.company_id
  WHERE l.company_id = NEW.company_id AND l.id = NEW.line_id;
  IF NOT FOUND OR line.kind <> 'measured' OR line.reverses_entry_id IS NOT NULL
    OR line.sequence <> line.entry_count + 1 THEN
    RAISE EXCEPTION 'line_conversions: a conversion is added only to a measured line of the entry being posted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER line_conversion_rules BEFORE INSERT ON line_conversions
  FOR EACH ROW EXECUTE FUNCTION line_conversion_rules();
--> statement-breakpoint
ALTER TABLE line_conversions ENABLE ALWAYS TRIGGER line_conversion_rules;
--> statement-breakpoint

-- A posting request is stored only with its entry: deferred to commit, since the entry follows
-- the request in the posting transaction. A replay inserts no request (ON CONFLICT DO NOTHING).
CREATE FUNCTION posting_request_used() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.company_id = NEW.company_id AND e.request_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'posting request % was stored without its entry', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER posting_requests_used AFTER INSERT ON posting_requests
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION posting_request_used();
--> statement-breakpoint
ALTER TABLE posting_requests ENABLE ALWAYS TRIGGER posting_requests_used;
