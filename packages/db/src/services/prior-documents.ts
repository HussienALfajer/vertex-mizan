import { documentOf, type EventEnvelope, type PriorDocuments } from '@vertex-mizan/contracts';
import { sql } from 'drizzle-orm';
import type { Transaction } from '../client.js';
import { openingSnapshots, openings } from '../schema/opening.js';

/**
 * The event types that void, change, archive or reopen a document Hub may list in its register of
 * prior documents (S10 rules 5, 28), with the register's list and the field naming the document.
 */
const PRIOR_DOCUMENT_EVENTS = {
  'invoice.voided': ['invoices', 'invoice'],
  'payment.voided': ['payments', 'payment'],
  'ad_wallet.entry_voided': ['wallet_entries', 'entry'],
  'ad_spend.changed': ['spend_updates', 'update'],
  'ad_spend.archived': ['spend_updates', 'update'],
  'project_expense.changed': ['project_expenses', 'expense'],
  'project_expense.archived': ['project_expenses', 'expense'],
  'milestone.reopened': ['milestone_dones', 'milestone'],
} as const satisfies Partial<
  Record<EventEnvelope['type'], readonly [keyof PriorDocuments, string]>
>;

/**
 * Whether the event voids, changes, archives or reopens a document the posted opening's snapshot
 * lists in its register of prior documents (S10 rule 28): Mizan holds no posting of it to reverse,
 * so the event needs the accountant. The register is read in SQL by containment, through
 * `opening_snapshots_company_prior_documents_idx`, never parsed here; a reversed opening's snapshot
 * is not read.
 */
export async function aboutPriorDocument(tx: Transaction, event: EventEnvelope): Promise<boolean> {
  const listed = (PRIOR_DOCUMENT_EVENTS as Partial<Record<string, readonly [string, string]>>)[
    event.type
  ];
  if (listed === undefined) return false;
  const [list, field] = listed;
  const document = { [list]: [{ [field]: { id: documentOf(event).id } }] };
  const result = await tx.execute<{ listed: boolean }>(sql`
    select exists (
      select 1 from ${openings} o
      join ${openingSnapshots} s on s.company_id = o.company_id and s.id = o.snapshot_id
      where o.state = 'posted'
        and (s.payload -> 'prior_documents') @> ${JSON.stringify(document)}::jsonb
    ) as listed`);
  return result.rows[0]?.listed === true;
}
