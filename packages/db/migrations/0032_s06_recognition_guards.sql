-- The guards and grants of S06's recognition tables (0031), as packages/db/CLAUDE.md and the
-- /db-migration skill write them (ADR 0003, ADR 0005, ADR 0008, ADR 0015):
-- - forced RLS with the one company_isolation policy on both tables;
-- - schedules and movements are append-only: SELECT, INSERT for the app role, refuse_change() for
--   every role;
-- - a schedule is opened by an `invoice.issued` of its company and deferred to a postable, non-control
--   liability account (S06 "Data"), on insert;
-- - a movement describes an entry posted in its own transaction (S06 "Data": written only beside
--   `post()`), and a schedule has one `deferred` movement, its first, on insert;
-- - what a schedule still holds never goes below zero in its transaction amount, and is zero in
--   every ledger when its transaction amount is (S06 "Data", "Allocation"), at commit.
-- The service-agency defaults of the four new slots are filled for existing companies by the
-- worker's start after the deploy, not here: a value added to an enum cannot be used in the
-- transaction that added it, and drizzle-kit migrates in one transaction.
-- Every trigger is ENABLE ALWAYS (ADR 0008); every guard function is pinned in test/conventions.ts
-- and names its tables with the schema. Nothing is granted to mizan_jobs, mizan_queue or PUBLIC; no
-- function is SECURITY DEFINER.
ALTER TABLE recognition_schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recognition_schedules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON recognition_schedules
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE recognition_movements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recognition_movements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON recognition_movements
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
REVOKE ALL ON recognition_schedules, recognition_movements FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON recognition_schedules, recognition_movements TO mizan_app;
--> statement-breakpoint
CREATE TRIGGER recognition_schedules_refuse_change BEFORE UPDATE OR DELETE ON recognition_schedules
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER recognition_schedules_refuse_truncate BEFORE TRUNCATE ON recognition_schedules
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE recognition_schedules ENABLE ALWAYS TRIGGER recognition_schedules_refuse_change;
--> statement-breakpoint
ALTER TABLE recognition_schedules ENABLE ALWAYS TRIGGER recognition_schedules_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER recognition_movements_refuse_change BEFORE UPDATE OR DELETE ON recognition_movements
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER recognition_movements_refuse_truncate BEFORE TRUNCATE ON recognition_movements
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE recognition_movements ENABLE ALWAYS TRIGGER recognition_movements_refuse_change;
--> statement-breakpoint
ALTER TABLE recognition_movements ENABLE ALWAYS TRIGGER recognition_movements_refuse_truncate;
--> statement-breakpoint
-- A schedule as it is inserted: its event an `invoice.issued` of its company, its liability account
-- a postable liability account that is not a control account, read FOR SHARE so it cannot change
-- meanwhile (S06 "Data", "Mapping slots").
CREATE FUNCTION recognition_schedule_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  account record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.inbound_events e
    WHERE e.company_id = NEW.company_id AND e.id = NEW.event_id AND e.type = 'invoice.issued'
  ) THEN
    RAISE EXCEPTION 'recognition_schedules: a schedule is opened by an invoice.issued event'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT a.kind, a.class, a.is_control INTO account
  FROM public.chart_accounts a
  WHERE a.company_id = NEW.company_id AND a.id = NEW.liability_account_id
  FOR SHARE;
  IF NOT FOUND OR account.kind <> 'postable' OR account.class <> 'liability' OR account.is_control THEN
    RAISE EXCEPTION 'recognition_schedules: a schedule is deferred to a postable liability account'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER recognition_schedule_rules BEFORE INSERT ON recognition_schedules
  FOR EACH ROW EXECUTE FUNCTION recognition_schedule_rules();
--> statement-breakpoint
ALTER TABLE recognition_schedules ENABLE ALWAYS TRIGGER recognition_schedule_rules;
--> statement-breakpoint
-- A movement as it is inserted: its entry, when it has one, was posted in this transaction (its
-- creation time is the transaction's), so a movement never describes an entry after the fact; a schedule's first
-- movement is its one `deferred` movement.
CREATE FUNCTION recognition_movement_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  earlier integer;
BEGIN
  IF NEW.entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.company_id = NEW.company_id AND e.id = NEW.entry_id AND e.created_at = now()
  ) THEN
    RAISE EXCEPTION 'recognition_movements: a movement describes an entry of its transaction'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT count(*) INTO earlier
  FROM public.recognition_movements m
  WHERE m.company_id = NEW.company_id AND m.schedule_id = NEW.schedule_id;
  IF (earlier = 0) <> (NEW.kind = 'deferred') THEN
    RAISE EXCEPTION 'recognition_movements: a schedule opens with its one deferred movement'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER recognition_movement_rules BEFORE INSERT ON recognition_movements
  FOR EACH ROW EXECUTE FUNCTION recognition_movement_rules();
--> statement-breakpoint
ALTER TABLE recognition_movements ENABLE ALWAYS TRIGGER recognition_movement_rules;
--> statement-breakpoint
-- What a schedule still holds, at commit: never below zero in its transaction amount, and zero in
-- every ledger when its transaction amount is zero (S06 "Data"). `sum()` skips nulls, so the
-- parallel amount is compared through its count too.
CREATE FUNCTION recognition_schedule_remaining() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  remaining record;
BEGIN
  SELECT sum(m.transaction_minor) AS transaction_minor, sum(m.book_minor) AS book_minor,
    sum(m.parallel_minor) AS parallel_minor, count(m.parallel_minor) AS parallel_count,
    count(*) AS movement_count
  INTO remaining
  FROM public.recognition_movements m
  WHERE m.company_id = NEW.company_id AND m.schedule_id = NEW.schedule_id;
  IF remaining.parallel_count NOT IN (0, remaining.movement_count) THEN
    RAISE EXCEPTION 'recognition schedule %: a parallel amount on some movements only', NEW.schedule_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF remaining.transaction_minor < 0 OR (remaining.transaction_minor = 0
    AND (remaining.book_minor <> 0 OR coalesce(remaining.parallel_minor, 0) <> 0)) THEN
    RAISE EXCEPTION 'recognition schedule %: RELEASE_EXCEEDS_BALANCE', NEW.schedule_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recognition_movements_remaining AFTER INSERT ON recognition_movements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION recognition_schedule_remaining();
--> statement-breakpoint
ALTER TABLE recognition_movements ENABLE ALWAYS TRIGGER recognition_movements_remaining;
