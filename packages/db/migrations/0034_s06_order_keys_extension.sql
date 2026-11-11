-- S06 rule 17: an event's further order keys (`inbound_events.order_keys`, the next migration) are
-- read with a GIN index that starts with company_id, as every secondary index of a company table
-- does (ADR 0003). A GIN index over a uuid column needs btree_gin's operator classes. btree_gin is a
-- trusted contrib extension (PostgreSQL 13 and later), so the owner role installs it with its CREATE
-- privilege on the database, and owns it; it adds operator classes and their support functions,
-- none SECURITY DEFINER, and no table.
CREATE EXTENSION IF NOT EXISTS btree_gin;
