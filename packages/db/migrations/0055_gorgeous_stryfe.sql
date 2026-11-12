ALTER TABLE "api_clients" DROP CONSTRAINT "api_clients_scopes";--> statement-breakpoint
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_scopes" CHECK (cardinality("api_clients"."scopes") between 1 and 4
        and "api_clients"."scopes" <@ array['events:write', 'periods:read', 'reconciliation:write', 'opening:write']::text[]
        and array_position("api_clients"."scopes", null) is null);