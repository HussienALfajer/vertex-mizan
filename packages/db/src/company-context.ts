import { sql } from 'drizzle-orm';
import type { Database, Transaction } from './client.js';

/** The transaction setting every RLS policy reads, through `current_company_id()` (ADR 0003). */
export const COMPANY_SETTING = 'app.company_id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `work` in one transaction that sees and writes only `companyId`'s rows (ADR 0003). The
 * setting is transaction-local, so it never leaks to the next user of the pooled connection.
 * `companyId` comes from the authenticated session's active company or from the API client's
 * company, never from request input.
 */
export async function withCompany<T>(
  db: Database,
  companyId: string,
  work: (tx: Transaction) => Promise<T>,
  options: CompanyTransactionOptions = {},
): Promise<T> {
  if (!UUID.test(companyId)) throw new Error('withCompany needs the company id as a UUID');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config(${COMPANY_SETTING}, ${companyId}, true)`);
    return work(tx);
  }, options);
}

/**
 * A snapshot for reads that must agree with each other (the integrity check, the full export):
 * `repeatable read` sees the database as it was at the transaction's first query.
 */
export interface CompanyTransactionOptions {
  isolationLevel?: 'repeatable read';
}
