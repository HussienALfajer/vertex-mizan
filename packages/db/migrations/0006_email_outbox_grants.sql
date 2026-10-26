-- The grants of the email outbox (0005, S01; owner decision 2026-10-26), an ephemeral platform
-- table: the API inserts an email in the transaction of its change, and the worker, as the app
-- role, sends it, records a failed attempt and deletes it once sent. Nothing is granted to
-- mizan_jobs, mizan_queue or PUBLIC.
REVOKE ALL ON email_outbox FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON email_outbox TO mizan_app;
