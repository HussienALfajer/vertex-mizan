-- S01 rule 2 (owner, 2026-11-16): a person is exempt from two-factor only when the row is made
-- so, by `admin:create-account`. No update sets the exemption on an existing person, whatever the
-- role; clearing it is allowed.
CREATE FUNCTION users_two_factor_exempt_rule() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.two_factor_exempt AND NOT OLD.two_factor_exempt THEN
    RAISE EXCEPTION 'users: the two-factor exemption is set only when a person is created'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER users_two_factor_exempt_rule BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users_two_factor_exempt_rule();
--> statement-breakpoint
ALTER TABLE users ENABLE ALWAYS TRIGGER users_two_factor_exempt_rule;
