import { type EmailData, type EmailKind, emailDataSchemas } from '@vertex-mizan/contracts';
import { emailOutbox, type Transaction } from '@vertex-mizan/db';

/**
 * Queues an email in the transaction of the change that sends it (owner decision 2026-10-26): it
 * exists exactly when the change commits, and the worker's `email.send` job sends and deletes it.
 * The data is checked against its template's schema here, so a bad email fails the change.
 */
export async function queueEmail<Kind extends EmailKind>(
  tx: Transaction,
  kind: Kind,
  recipient: string,
  data: EmailData<Kind>,
): Promise<void> {
  const checked = emailDataSchemas[kind].parse(data);
  await tx.insert(emailOutbox).values({ kind, recipient: recipient.toLowerCase(), data: checked });
}
