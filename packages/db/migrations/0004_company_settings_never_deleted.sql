-- company_settings is never deleted (S01 rule 13, ADR 0005 retention), and deleting it would undo
-- the settings lock of 0002_access_guards.sql: a row deleted and inserted again could carry other
-- currencies and an empty books_started_at, and every posted line would then be read in them
-- (accountant-reviewer, S01 PR 1). The app role holds no DELETE; these triggers refuse DELETE and
-- TRUNCATE for every role, the owner included, ENABLE ALWAYS so a replica session cannot skip them
-- (ADR 0008). The convention test pins refuse_delete() and requires both triggers.

-- Refuses DELETE and TRUNCATE on a table whose rows are archived, never deleted.
CREATE FUNCTION refuse_delete() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is never deleted: % refused', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
--> statement-breakpoint
CREATE TRIGGER company_settings_refuse_delete BEFORE DELETE ON company_settings
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER company_settings_refuse_truncate BEFORE TRUNCATE ON company_settings
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE company_settings ENABLE ALWAYS TRIGGER company_settings_refuse_delete;
--> statement-breakpoint
ALTER TABLE company_settings ENABLE ALWAYS TRIGGER company_settings_refuse_truncate;
