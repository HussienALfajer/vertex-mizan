-- The guards and grants of S09's service departments (0046), as packages/db/CLAUDE.md and the
-- /db-migration skill write them (ADR 0003, ADR 0005, ADR 0008):
-- - forced RLS with the one company_isolation policy on service_departments;
-- - append-only: SELECT, INSERT for the app role, refuse_change() for every role;
-- - service_department_rules(): the service is a value of the built-in type service and the
--   department one of the type department; a manual row is for a service not from Hub (S09 rule
--   34, DIMENSION_FROM_HUB); its date is not in a closed month, read as the posting function
--   reads it (a month closed, or before the first period while a month is closed), the month's
--   period row read FOR SHARE so a close waits for the row or the row for the close (rules 33, 34).
-- Every trigger is ENABLE ALWAYS (ADR 0008); the guard function is pinned in test/conventions.ts
-- and names its tables with the schema. Nothing is granted to mizan_jobs, mizan_queue or PUBLIC; no
-- function is SECURITY DEFINER. No ledger row, rate or audit row changes.
ALTER TABLE service_departments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_departments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON service_departments
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
REVOKE ALL ON service_departments FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON service_departments TO mizan_app;
--> statement-breakpoint
CREATE TRIGGER service_departments_refuse_change BEFORE UPDATE OR DELETE
  ON service_departments FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER service_departments_refuse_truncate BEFORE TRUNCATE ON service_departments
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE service_departments ENABLE ALWAYS TRIGGER service_departments_refuse_change;
--> statement-breakpoint
ALTER TABLE service_departments ENABLE ALWAYS TRIGGER service_departments_refuse_truncate;
--> statement-breakpoint
CREATE FUNCTION service_department_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  service record;
  department_type text;
  period_state text;
BEGIN
  SELECT t.code AS type_code, t.builtin, v.external_source INTO service
  FROM public.dimension_values v
  JOIN public.dimension_types t ON t.company_id = v.company_id AND t.id = v.type_id
  WHERE v.company_id = NEW.company_id AND v.id = NEW.service_value_id;
  IF NOT FOUND OR service.type_code <> 'service' OR NOT service.builtin THEN
    RAISE EXCEPTION 'service_departments: a department is a service value''s'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT t.code INTO department_type
  FROM public.dimension_values v
  JOIN public.dimension_types t ON t.company_id = v.company_id AND t.id = v.type_id
  WHERE v.company_id = NEW.company_id AND v.id = NEW.department_value_id AND t.builtin;
  IF NOT FOUND OR department_type <> 'department' THEN
    RAISE EXCEPTION 'service_departments: a service''s department is a department value'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.source = 'manual' AND service.external_source IS NOT NULL THEN
    RAISE EXCEPTION 'service_departments: DIMENSION_FROM_HUB: a Hub service''s department comes from Hub'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT p.state INTO period_state
  FROM public.periods p
  WHERE p.company_id = NEW.company_id AND p.period = to_char(NEW.effective_from, 'YYYY-MM')
  FOR SHARE;
  IF period_state = 'closed' OR (
    -- No row for the month and none before it: a month before the first period.
    NOT FOUND
    AND NOT EXISTS (
      SELECT 1 FROM public.periods p
      WHERE p.company_id = NEW.company_id AND p.period < to_char(NEW.effective_from, 'YYYY-MM')
    )
    AND EXISTS (
      SELECT 1 FROM public.periods p
      WHERE p.company_id = NEW.company_id AND p.state = 'closed'
    )
  ) THEN
    RAISE EXCEPTION 'service_departments: PERIOD_CLOSED: a department takes effect in an open month, not %',
      NEW.effective_from
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER service_department_rules BEFORE INSERT ON service_departments
  FOR EACH ROW EXECUTE FUNCTION service_department_rules();
--> statement-breakpoint
ALTER TABLE service_departments ENABLE ALWAYS TRIGGER service_department_rules;
