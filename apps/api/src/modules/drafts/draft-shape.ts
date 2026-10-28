import type {
  CurrencyCode,
  DealtRate,
  Draft,
  DraftInput,
  DraftLine,
  DraftLineInput,
  DraftState,
  DraftSummary,
} from '@vertex-mizan/contracts';
import {
  chartAccounts,
  entryAttachments,
  entryDraftLines,
  entryDrafts,
  type PersonActor,
  type Transaction,
  writeCompanyAudit,
} from '@vertex-mizan/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { CodedException } from '../../core/errors/coded-exception.js';
import { attachmentOf, peopleOf, personOf } from '../entries/entry-shape.js';

export type DraftRow = typeof entryDrafts.$inferSelect;
type LineRow = typeof entryDraftLines.$inferSelect;

/** A draft of the company, locked for a change when asked; another company's id is `NOT_FOUND`. */
export async function draftRow(
  tx: Transaction,
  id: string,
  lock: 'update' | null = null,
): Promise<DraftRow> {
  const query = tx.select().from(entryDrafts).where(eq(entryDrafts.id, id));
  const [row] = lock === 'update' ? await query.for('update') : await query;
  if (!row) throw new CodedException('NOT_FOUND', 'No such draft');
  return row;
}

/** The lines of a draft as typed, in line order, the removed ones left out. */
export async function draftLines(tx: Transaction, draftId: string): Promise<DraftLine[]> {
  const rows = await tx
    .select()
    .from(entryDraftLines)
    .where(and(eq(entryDraftLines.draftId, draftId), isNull(entryDraftLines.archivedAt)))
    .orderBy(asc(entryDraftLines.lineNo));
  return rows.map(lineOf);
}

function lineOf(row: LineRow): DraftLine {
  return {
    lineNo: row.lineNo,
    accountId: row.accountId,
    dimensionValueIds: row.dimensionValueIds,
    currency: row.currency as CurrencyCode | null,
    amountMinor: row.amountMinor?.toString() ?? null,
    memo: row.memo,
  };
}

/** A draft with its lines and attachments (`GET /api/drafts/:id`). */
export async function readDraft(tx: Transaction, id: string): Promise<Draft> {
  const row = await draftRow(tx, id);
  const lines = await draftLines(tx, id);
  const attachments = await tx
    .select()
    .from(entryAttachments)
    .where(and(eq(entryAttachments.draftId, id), isNull(entryAttachments.archivedAt)))
    .orderBy(asc(entryAttachments.createdAt));
  const people = await peopleOf(tx, [
    row.preparedByUserId,
    row.submittedByUserId,
    row.rejectedByUserId,
    ...attachments.map((attachment) => attachment.uploadedByUserId),
  ]);
  return {
    id: row.id,
    state: row.state as DraftState,
    entryDate: row.entryDate,
    description: row.description,
    reference: row.reference,
    dealtRates: row.dealtRates as DealtRate[],
    reversesEntryId: row.reversesEntryId,
    copiedFromEntryId: row.copiedFromEntryId,
    lines,
    preparedBy: personOf(people, row.preparedByUserId),
    submitted:
      row.submittedByUserId && row.submittedAt
        ? { by: personOf(people, row.submittedByUserId), at: row.submittedAt.toISOString() }
        : null,
    rejected:
      row.rejectedByUserId && row.rejectedAt && row.rejectedReason
        ? {
            by: personOf(people, row.rejectedByUserId),
            at: row.rejectedAt.toISOString(),
            reason: row.rejectedReason,
          }
        : null,
    postedEntryId: row.postedEntryId,
    archived: row.archivedAt
      ? { at: row.archivedAt.toISOString(), reason: row.archivedReason }
      : null,
    attachments: attachments.map((attachment) => attachmentOf(attachment, people)),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A row of the drafts list. */
export function summaryOf(
  row: DraftRow,
  lineCount: number,
  people: Awaited<ReturnType<typeof peopleOf>>,
): DraftSummary {
  return {
    id: row.id,
    state: row.state as DraftState,
    entryDate: row.entryDate,
    description: row.description,
    reference: row.reference,
    reversesEntryId: row.reversesEntryId,
    lineCount,
    preparedBy: personOf(people, row.preparedByUserId),
    submitted:
      row.submittedByUserId && row.submittedAt
        ? { by: personOf(people, row.submittedByUserId), at: row.submittedAt.toISOString() }
        : null,
    rejected: row.rejectedReason !== null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The lines as the audit log keeps them: what was typed, amounts as integer strings. */
export const auditedLines = (lines: readonly (DraftLine | DraftLineInput)[]) =>
  lines.map((line) => ({
    accountId: line.accountId,
    dimensionValueIds: line.dimensionValueIds,
    currency: line.currency,
    amountMinor: line.amountMinor,
    memo: line.memo,
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
  if (unknown.length > 0) throw new CodedException('VALIDATION_FAILED', 'Unknown account', unknown);
  const rows = await tx.select().from(entryDraftLines).where(eq(entryDraftLines.draftId, draftId));
  const byNumber = new Map(rows.map((row) => [row.lineNo, row]));
  for (const [index, line] of lines.entries()) {
    const values = {
      accountId: line.accountId,
      dimensionValueIds: [...line.dimensionValueIds],
      currency: line.currency,
      amountMinor: line.amountMinor === null ? null : BigInt(line.amountMinor),
      memo: line.memo,
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
