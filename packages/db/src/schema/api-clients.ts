import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  cidr,
  foreignKey,
  index,
  inet,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './access.js';
import {
  archivedAt,
  companyId,
  createdAt,
  id,
  idIsUuidV7,
  timestamptz,
  updatedAt,
} from './columns.js';
import { companies } from './companies.js';

// The api-clients module (S05 "Data", ADR 0003, ADR 0006): the systems that post to a company's
// ledger and their keys, and which client is the source of each document type of a company. A key
// is looked up before any company context exists, so clients and keys are platform tables, scoped
// by `scope_company_id` like memberships; the document sources are a company table.

/** `API_CLIENT_SYSTEMS` of contracts (a test keeps them equal). */
export const CLIENT_SYSTEMS = ['hub'] as const;

/** `API_CLIENT_SCOPES` of contracts (a test keeps them equal). */
export const CLIENT_SCOPES = ['events:write', 'periods:read', 'reconciliation:write'] as const;

/** `DOCUMENT_TYPES` of contracts (a test keeps them equal). */
export const SOURCE_DOCUMENT_TYPES = [
  'invoice',
  'payment',
  'project_expense',
  'ad_wallet_entry',
  'ad_spend',
  'milestone',
  'project',
  'rate',
] as const;

const listOf = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * A system that posts to one company (S05 rule 19): its name, its scopes and its IP allow-list
 * (empty: any address). Created and changed by the owner after a fresh two-factor code; archived,
 * never deleted.
 */
export const apiClients = pgTable(
  'api_clients',
  {
    id: id(),
    scopeCompanyId: uuid()
      .notNull()
      .references((): AnyPgColumn => companies.id),
    name: text().notNull(),
    system: text().notNull(),
    scopes: text().array().notNull(),
    ipAllowList: cidr().array().notNull().default(sql`'{}'`),
    createdByUserId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('api_clients', t.id),
    unique('api_clients_name_key').on(t.scopeCompanyId, t.name),
    unique('api_clients_scope_company_id_id_key').on(t.scopeCompanyId, t.id),
    index('api_clients_created_by_user_id_idx').on(t.createdByUserId),
    check('api_clients_name', sql`char_length(${t.name}) between 1 and 100`),
    check('api_clients_system', sql`${t.system} in (${listOf(CLIENT_SYSTEMS)})`),
    check(
      'api_clients_scopes',
      sql`cardinality(${t.scopes}) between 1 and ${sql.raw(String(CLIENT_SCOPES.length))}
        and ${t.scopes} <@ array[${listOf(CLIENT_SCOPES)}]::text[]
        and array_position(${t.scopes}, null) is null`,
    ),
    check(
      'api_clients_ip_allow_list',
      sql`cardinality(${t.ipAllowList}) <= 50 and array_position(${t.ipAllowList}, null) is null`,
    ),
  ],
);

/**
 * A client's key (S05 rules 19–20): only the SHA-256 of the whole key is stored, and its prefix
 * (`mzn_` and its first 8 characters) shown in lists. At most two active keys per client, for a
 * rotation (a guard; `API_KEY_LIMIT`); a revoked key is kept and never changes again. A key ends by
 * its revocation: `archived_at`, the business kind's column, stays empty.
 */
export const apiClientKeys = pgTable(
  'api_client_keys',
  {
    id: id(),
    apiClientId: uuid().notNull(),
    scopeCompanyId: uuid().notNull(),
    prefix: text().notNull(),
    secretHash: text().notNull(),
    createdByUserId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    /** Updated at most once a minute per key. */
    lastUsedAt: timestamptz(),
    lastUsedIp: inet(),
    revokedAt: timestamptz(),
    /** The owner who revoked it, or who archived the company (S01 rule 12). */
    revokedByUserId: uuid().references(() => users.id),
    revokeReason: text(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('api_client_keys', t.id),
    foreignKey({
      name: 'api_client_keys_client_fk',
      columns: [t.scopeCompanyId, t.apiClientId],
      foreignColumns: [apiClients.scopeCompanyId, apiClients.id],
    }),
    index('api_client_keys_client_idx').on(t.scopeCompanyId, t.apiClientId),
    unique('api_client_keys_secret_hash_key').on(t.secretHash),
    unique('api_client_keys_prefix_key').on(t.prefix),
    index('api_client_keys_created_by_user_id_idx').on(t.createdByUserId),
    index('api_client_keys_revoked_by_user_id_idx').on(t.revokedByUserId),
    check('api_client_keys_prefix', sql`${t.prefix} ~ '^mzn_[0-9A-Za-z]{8}$'`),
    check('api_client_keys_secret_hash', sql`${t.secretHash} ~ '^[0-9a-f]{64}$'`),
    check('api_client_keys_last_use', sql`(${t.lastUsedAt} is null) = (${t.lastUsedIp} is null)`),
    check(
      'api_client_keys_revocation',
      sql`(${t.revokedAt} is null) = (${t.revokeReason} is null)
        and (${t.revokedAt} is null) = (${t.revokedByUserId} is null)
        and (${t.revokeReason} is null or char_length(${t.revokeReason}) between 1 and 500)`,
    ),
    check('api_client_keys_never_archived', sql`${t.archivedAt} is null`),
  ],
);

/**
 * The API client each Hub document type of a company comes from (S05 rule 21): an event of a type
 * whose source is another client, or none (archived), is refused `SOURCE_NOT_ALLOWED`. One row per
 * company and document type; moving a type changes its client.
 */
export const documentSources = pgTable(
  'document_sources',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    documentType: text().notNull(),
    /** A platform id, kept without a key; a guard checks it is a client of this company. */
    apiClientId: uuid().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('document_sources', t.id),
    unique('document_sources_document_type_key').on(t.companyId, t.documentType),
    index('document_sources_company_client_idx').on(t.companyId, t.apiClientId),
    check(
      'document_sources_document_type',
      sql`${t.documentType} in (${listOf(SOURCE_DOCUMENT_TYPES)})`,
    ),
  ],
);
