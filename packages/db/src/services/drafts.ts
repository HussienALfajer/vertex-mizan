import {
  DomainError,
  type DraftInput,
  type DraftLine,
  type DraftLineInput,
} from '@vertex-mizan/contracts';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { writeCompanyAudit } from '../audit.js';
import type { Transaction } from '../client.js';
import { chartAccounts } from '../schema/chart.js';
import { entryAttachments, entryDraftLines, entryDrafts } from '../schema/drafts.js';
import { openItems } from '../schema/open-items.js';
import { recognitionSchedules } from '../schema/recognition.js';
import type { PersonActor } from './rates.js';

// The drafts' writes that the API's drafts and entries modules and the scenario book's `draft` and
// `discard` steps share (S03 rules 4 and 11; S07's checklist reads drafts): a draft made with its
// lines as typed and its audit row, and a draft discarded with its attachments.

/** The lines as the audit log keeps them: what was typed, amounts as integer strings. */
export const auditedLines = (lines: readonly (DraftLine | DraftLineInput)[]) =>
  lines.map((line) => ({
    accountId: line.accountId,
    dimensionValueIds: line.dimensionValueIds,
    currency: line.currency,
    amountMinor: line.amountMinor,
    memo: line.memo,
    openItemId: line.openItemId,
    newItem: line.newItem,
    // Only when set, so an audit row of S04's shape reads as it did.
    ...(line.scheduleId !== null && { scheduleId: line.scheduleId }),
  }));

/**
 * Stores a draft's lines as typed: line `n` of the input in the row of number `n`, made the first
 * time; rows past the input's last line are archived (a draft's rows are never deleted, and a
 * number's row is taken back when the draft grows again).
 */
export async function writeLines(
  tx: Transaction,
  companyId: string,
  draftId: string,
  lines: readonly DraftLineInput[],
): Promise<void> {
  // An account of another company, or none, is refused here rather than by its foreign key.
  const accountIds = [
    ...new Set(lines.flatMap((line) => (line.accountId === null ? [] : [line.accountId]))),
  ];
  const known = new Set(
    accountIds.length === 0
      ? []
      : (
          await tx
            .select({ id: chartAccounts.id })
            .from(chartAccounts)
            .where(inArray(chartAccounts.id, accountIds))
        ).map((row) => row.id),
  );
  const unknown = lines.flatMap((line, index) =>
    line.accountId !== null && !known.has(line.accountId)
      ? [{ path: ['lines', index, 'accountId'], message: 'Unknown account' }]
      : [],
  );
  if (unknown.length > 0)
    throw new DomainError('VALIDATION_FAILED', 'Unknown account', { issues: unknown });
  // An item of another company, or none, likewise (S04): the item cell names an item by its id.
  const itemIds = [
    ...new Set(lines.flatMap((line) => (line.openItemId === null ? [] : [line.openItemId]))),
  ];
  const knownItems = new Set(
    itemIds.length === 0
      ? []
      : (
          await tx
            .select({ id: openItems.id })
            .from(openItems)
            .where(inArray(openItems.id, itemIds))
        ).map((row) => row.id),
  );
  const unknownItems = lines.flatMap((line, index) =>
    line.openItemId !== null && !knownItems.has(line.openItemId)
      ? [{ path: ['lines', index, 'openItemId'], message: 'Unknown open item' }]
      : [],
  );
  if (unknownItems.length > 0) {
    throw new DomainError('VALIDATION_FAILED', 'Unknown open item', { issues: unknownItems });
  }
  // A schedule of another company, or none, likewise (S10 rule 28).
  const scheduleIds = [
    ...new Set(lines.flatMap((line) => (line.scheduleId === null ? [] : [line.scheduleId]))),
  ];
  const knownSchedules = new Set(
    scheduleIds.length === 0
      ? []
      : (
          await tx
            .select({ id: recognitionSchedules.id })
            .from(recognitionSchedules)
            .where(inArray(recognitionSchedules.id, scheduleIds))
        ).map((row) => row.id),
  );
  const unknownSchedules = lines.flatMap((line, index) =>
    line.scheduleId !== null && !knownSchedules.has(line.scheduleId)
      ? [{ path: ['lines', index, 'scheduleId'], message: 'Unknown schedule' }]
      : [],
  );
  if (unknownSchedules.length > 0) {
    throw new DomainError('VALIDATION_FAILED', 'Unknown schedule', { issues: unknownSchedules });
  }
  const rows = await tx.select().from(entryDraftLines).where(eq(entryDraftLines.draftId, draftId));
  const byNumber = new Map(rows.map((row) => [row.lineNo, row]));
  for (const [index, line] of lines.entries()) {
    const values = {
      accountId: line.accountId,
      dimensionValueIds: [...line.dimensionValueIds],
      currency: line.currency,
      amountMinor: line.amountMinor === null ? null : BigInt(line.amountMinor),
      memo: line.memo,
      openItemId: line.openItemId,
      newItemReference: line.newItem?.reference ?? null,
      newItemDueOn: line.newItem?.dueOn ?? null,
      scheduleId: line.scheduleId,
      archivedAt: null,
    };
    const row = byNumber.get(index + 1);
    if (row) {
      await tx.update(entryDraftLines).set(values).where(eq(entryDraftLines.id, row.id));
    } else {
      await tx
        .insert(entryDraftLines)
        .values({ id: uuidv7(), companyId, draftId, lineNo: index + 1, ...values });
    }
  }
  for (const row of rows) {
    if (row.lineNo > lines.length && row.archivedAt === null) {
      await tx
        .update(entryDraftLines)
        .set({ archivedAt: new Date() })
        .where(eq(entryDraftLines.id, row.id));
    }
  }
}

/** Where a new draft comes from: typed, a copy of an entry, or a reversal waiting for approval. */
export interface DraftOrigin {
  readonly copiedFromEntryId?: string;
  readonly reversesEntryId?: string;
}

/** Makes a draft with its lines and its `draft.created` audit row, in the caller's transaction. */
export async function insertDraft(
  tx: Transaction,
  companyId: string,
  actor: PersonActor,
  input: DraftInput,
  origin: DraftOrigin = {},
): Promise<string> {
  const id = uuidv7();
  await tx.insert(entryDrafts).values({
    id,
    companyId,
    state: 'draft',
    entryDate: input.entryDate,
    description: input.description,
    reference: input.reference,
    dealtRates: input.dealtRates,
    reversesEntryId: origin.reversesEntryId ?? null,
    copiedFromEntryId: origin.copiedFromEntryId ?? null,
    preparedByUserId: actor.userId,
  });
  await writeLines(tx, companyId, id, input.lines);
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'draft.created',
    entityType: 'entry_draft',
    entityId: id,
    after: {
      state: 'draft',
      entryDate: input.entryDate,
      description: input.description,
      reference: input.reference,
      dealtRates: input.dealtRates,
      lines: auditedLines(input.lines),
      ...(origin.reversesEntryId && { reversesEntryId: origin.reversesEntryId }),
      ...(origin.copiedFromEntryId && { copiedFromEntryId: origin.copiedFromEntryId }),
    },
  });
  return id;
}

/**
 * Discards a draft being prepared with a reason (S03 rule 11): it and its attachments archived,
 * with its `draft.discarded` audit row, in the caller's transaction, after the caller's checks.
 */
export async function discardDraft(
  tx: Transaction,
  companyId: string,
  actor: PersonActor,
  id: string,
  reason: string | null,
): Promise<void> {
  const now = new Date();
  await tx
    .update(entryAttachments)
    .set({ archivedAt: now })
    .where(and(eq(entryAttachments.draftId, id), isNull(entryAttachments.archivedAt)));
  await tx
    .update(entryDrafts)
    .set({ archivedAt: now, archivedReason: reason })
    .where(eq(entryDrafts.id, id));
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'draft.discarded',
    entityType: 'entry_draft',
    entityId: id,
    reason,
    before: { archivedReason: null },
    after: { archivedReason: reason },
  });
}
