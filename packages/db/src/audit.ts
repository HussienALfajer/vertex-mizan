import type { CompanyAuditAction, PlatformAuditAction } from '@vertex-mizan/contracts';
import type { Database, Transaction } from './client.js';
import { auditEntries, platformAuditEntries } from './schema/audit.js';

// The audit writers (S01 rule 23, ADR 0005 invariant 10): one row per change, in the transaction of
// the change. They live beside the schema because the posting function writes its `entry.posted`
// row itself (S03); the API's `core/audit/audit.ts` re-exports them.

/** Where a request came from, for both audit logs (S01 rule 25). */
export interface RequestFacts {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Who did it: a person (with their name as it was and their session) or the system (a server
 * command, a job). API clients join with S05.
 */
export type AuditActor = RequestFacts &
  (
    | { kind: 'person'; userId: string; name: string; sessionId: string | null }
    | { kind: 'system'; name: string }
  );

/** The name the logs show for the server commands and jobs. */
export const SYSTEM_NAME = 'Vertex';

/**
 * The fields each audited entity may record before and after (S01 rule 23): an allow-list, so a
 * password, token, secret, backup code or hash never reaches the log. A field outside it fails
 * the change.
 */
export const AUDITED_FIELDS = {
  company: ['name', 'nameLatin', 'archivedReason'],
  company_settings: [
    'bookCurrency',
    'bookRateType',
    'bookAcceptsTransactionRate',
    'parallelCurrency',
    'parallelRateType',
    'parallelAcceptsTransactionRate',
    'fiscalYearStartMonth',
    'policyNote',
    'bulletinDaysOff',
  ],
  membership: ['userId', 'role', 'canClosePeriods', 'archivedReason'],
  invitation: ['email', 'role', 'canClosePeriods', 'expiresAt'],
  user: ['twoFactorEnabled'],
  session: ['activeCompanyId'],
  audit_log: [],
  // S02: the chart of accounts, dimensions and rates.
  account: [
    'code',
    'parentId',
    'level',
    'kind',
    'class',
    'name',
    'nameLatin',
    'normalBalance',
    'statementLine',
    'currency',
    'isControl',
    'isMonetary',
    'requiredDimensionTypeIds',
    'blockedReason',
    'archivedReason',
  ],
  chart: ['templateId', 'templateVersion', 'accountCount', 'format'],
  account_role: ['role', 'accountId'],
  dimension_type: ['code', 'name', 'nameLatin', 'position', 'archived'],
  dimension_value: [
    'typeId',
    'code',
    'name',
    'nameLatin',
    'contractKind',
    'parentValueId',
    'externalSource',
    'externalId',
    'archived',
  ],
  rate_pair: ['base', 'quote'],
  exchange_rate: ['effectiveOn', 'base', 'quote', 'rate', 'type', 'source', 'supersedesRateId'],
  bulletin_holiday: ['on', 'note', 'removed'],
  // S03: journal entries; a reversal names its original as `reverses`.
  journal_entry: [
    'fiscalYear',
    'number',
    'entryDate',
    'source',
    'description',
    'reference',
    'lineCount',
    'reverses',
  ],
} as const satisfies Record<string, readonly string[]>;

export type AuditedEntity = keyof typeof AUDITED_FIELDS;

type Fields = Record<string, unknown>;

export interface CompanyAuditEntry {
  action: CompanyAuditAction;
  entityType: AuditedEntity;
  entityId: string | null;
  reason?: string | null;
  before?: Fields | null;
  after?: Fields | null;
}

function allowed(entityType: AuditedEntity, fields: Fields | null | undefined): Fields | null {
  if (!fields) return null;
  const permitted: readonly string[] = AUDITED_FIELDS[entityType];
  for (const key of Object.keys(fields)) {
    if (!permitted.includes(key)) {
      throw new Error(`The audit log does not take ${entityType}.${key}`);
    }
  }
  // Dates as ISO strings, as the API answers them.
  return JSON.parse(JSON.stringify(fields)) as Fields;
}

/** The fields that differ between two states of an entity, before and after. */
export function changedFields(
  before: Fields,
  after: Fields,
): { before: Fields; after: Fields } | null {
  const keys = Object.keys(after).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  if (keys.length === 0) return null;
  return {
    before: Object.fromEntries(keys.map((key) => [key, before[key] ?? null])),
    after: Object.fromEntries(keys.map((key) => [key, after[key] ?? null])),
  };
}

/**
 * One row of a company's audit log, in the transaction of the change (ADR 0005 invariant 10).
 * `tx` must be inside `withCompany` for that company: forced RLS refuses the row otherwise.
 */
export async function writeCompanyAudit(
  tx: Transaction,
  companyId: string,
  actor: AuditActor,
  entry: CompanyAuditEntry,
): Promise<void> {
  await tx.insert(auditEntries).values({
    companyId,
    actorKind: actor.kind,
    actorUserId: actor.kind === 'person' ? actor.userId : null,
    actorName: actor.name,
    sessionId: actor.kind === 'person' ? actor.sessionId : null,
    requestId: actor.requestId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    reason: entry.reason ?? null,
    before: allowed(entry.entityType, entry.before),
    after: allowed(entry.entityType, entry.after),
  });
}

export interface PlatformAuditEntry {
  action: PlatformAuditAction;
  /** Null for an unknown person: a failed sign-in or a reset request for an unknown email. */
  actor: AuditActor | (RequestFacts & { kind: 'system'; name?: string });
  subjectCompanyId?: string | null;
  /** The address typed on a failed sign-in or reset request. */
  email?: string | null;
  /** Never a secret. */
  details?: Fields | null;
}

/** One row of the platform audit log: sign-in and account events, the server commands. */
export async function writePlatformAudit(
  db: Database | Transaction,
  entry: PlatformAuditEntry,
): Promise<void> {
  const { actor } = entry;
  await db.insert(platformAuditEntries).values({
    actorKind: actor.kind,
    actorUserId: actor.kind === 'person' ? actor.userId : null,
    subjectCompanyId: entry.subjectCompanyId ?? null,
    action: entry.action,
    email: entry.email?.toLowerCase() ?? null,
    sessionId: actor.kind === 'person' ? actor.sessionId : null,
    requestId: actor.requestId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    details: entry.details ?? null,
  });
}
