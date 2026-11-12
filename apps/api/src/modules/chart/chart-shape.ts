import type { Account } from '@vertex-mizan/contracts';
import { accountLinksOf, accountOf, chartAccounts, type Transaction } from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';
import { CodedException } from '../../core/errors/coded-exception.js';

// An account as the API answers it: `packages/db`'s chart reads (moved there in S09 so the worker
// prints the same chart), and one account by id.
export {
  type AccountRow,
  accountOf,
  applyChartTemplate,
  levelOf,
  readChartAccounts as readChart,
} from '@vertex-mizan/db';

/** One account of the company's chart; another company's id answers like an unknown one. */
export async function readAccount(tx: Transaction, id: string): Promise<Account> {
  const [row] = await tx.select().from(chartAccounts).where(eq(chartAccounts.id, id));
  if (!row) throw new CodedException('NOT_FOUND', 'No such account');
  const { dimensions, roles } = await accountLinksOf(tx, [id]);
  return accountOf(row, dimensions.get(id) ?? [], roles.get(id) ?? []);
}
