import { companies, type Transaction } from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';
import { CodedException } from '../errors/coded-exception.js';

/**
 * Locks the active company's row inside a write's transaction and refuses the write if the company
 * is archived (S01 rule 12). The guard checked the archive before the handler; this check holds
 * until commit, because archiving takes `FOR NO KEY UPDATE` on the same row and waits for it.
 *
 * - `share` (`FOR SHARE`): ordinary writes, which may run side by side.
 * - `exclusive` (`FOR NO KEY UPDATE`): owner changes, run one after the other for the last-owner
 *   rule (S01 edge case 1). Audit inserts take `FOR KEY SHARE` through their foreign key and are
 *   blocked by neither.
 */
export async function lockCompanyForWrite(
  tx: Transaction,
  companyId: string,
  mode: 'share' | 'exclusive' = 'share',
): Promise<void> {
  const [company] = await tx
    .select({ archivedAt: companies.archivedAt })
    .from(companies)
    .where(eq(companies.id, companyId))
    .for(mode === 'share' ? 'share' : 'no key update');
  if (!company) throw new CodedException('NOT_FOUND', 'No such company');
  if (company.archivedAt) throw new CodedException('COMPANY_ARCHIVED', 'The company is archived');
}
