import type { DomainError, DraftLine, PostingRefusal } from '@vertex-mizan/contracts';
import {
  companySettings,
  type DealtRateSpec,
  entryAttachments,
  entryDrafts,
  type PersonActor,
  type PostedEntryRef,
  type PostingContent,
  post,
  type Transaction,
} from '@vertex-mizan/db';
import { and, eq, isNull } from 'drizzle-orm';
import { CodedException } from '../../core/errors/coded-exception.js';
import type { DraftRow } from './draft-shape.js';

/** Whether the company submits and approves manual entries before they post (S03 rule 8). */
export async function approvalIsOn(tx: Transaction): Promise<boolean> {
  const [settings] = await tx
    .select({ approval: companySettings.manualEntryApproval })
    .from(companySettings);
  return settings?.approval ?? false;
}

/**
 * What a draft lacks to be submitted or posted (S03 rule 5): a description, and at least two
 * complete lines (account, currency, a non-zero amount) with no incomplete one. A reversal's draft
 * has its original's lines.
 */
export function missingOf(draft: DraftRow, lines: readonly DraftLine[]): PostingRefusal[] {
  const refusals: PostingRefusal[] = [];
  if (draft.description === null) {
    refusals.push({
      code: 'VALIDATION_FAILED',
      message: 'A description is required',
      lineNo: null,
      details: { field: 'description' },
    });
  }
  if (draft.reversesEntryId !== null) return refusals;
  for (const line of lines) {
    if (line.accountId === null || line.currency === null || line.amountMinor === null) {
      refusals.push({
        code: 'VALIDATION_FAILED',
        message: 'An incomplete line',
        lineNo: line.lineNo,
        details: {
          field:
            line.accountId === null
              ? 'accountId'
              : line.currency === null
                ? 'currency'
                : 'amountMinor',
        },
      });
    }
  }
  if (lines.length < 2) {
    refusals.push({
      code: 'ENTRY_TOO_FEW_LINES',
      message: 'An entry has two lines at least',
      lineNo: null,
      details: {},
    });
  }
  return refusals;
}

/** Refuses a draft that lacks what rule 5 requires, naming each missing field. */
export function refuseIncomplete(draft: DraftRow, lines: readonly DraftLine[]): void {
  const [first, ...rest] = missingOf(draft, lines);
  if (!first) return;
  if (first.code === 'ENTRY_TOO_FEW_LINES' && rest.length === 0) {
    throw new CodedException('ENTRY_TOO_FEW_LINES', first.message);
  }
  throw new CodedException(
    'VALIDATION_FAILED',
    'The draft is incomplete',
    [first, ...rest].map((refusal) => ({
      path:
        refusal.lineNo === null
          ? [refusal.details.field ?? 'lines']
          : ['lines', refusal.lineNo - 1, refusal.details.field ?? ''],
      message: refusal.message,
    })),
  );
}

/** What a complete draft posts: its typed lines measured anew, or its original reversed. */
export function contentOf(
  draft: DraftRow,
  lines: readonly DraftLine[],
  today: string,
): PostingContent {
  if (draft.reversesEntryId !== null) {
    return { kind: 'reversal', entryId: draft.reversesEntryId, today };
  }
  return {
    kind: 'manual',
    today,
    dealtRates: draft.dealtRates as DealtRateSpec[],
    lines: lines.map((line) => ({
      accountId: line.accountId as string,
      dimensionValueIds: line.dimensionValueIds,
      currency: line.currency as NonNullable<DraftLine['currency']>,
      amountMinor: BigInt(line.amountMinor as string),
      memo: line.memo,
    })),
  };
}

/** A refusal of the posting function as the preview lists it. */
export function refusalOf(error: DomainError): PostingRefusal {
  const { lineNo, ...facts } = error.details ?? {};
  return {
    code: error.code,
    message: error.message,
    lineNo: typeof lineNo === 'number' ? lineNo : null,
    details: Object.fromEntries(
      Object.entries(facts)
        .filter(([, value]) => ['string', 'number', 'bigint'].includes(typeof value))
        .map(([key, value]) => [key, String(value)]),
    ),
  };
}

/**
 * Posts a complete draft through the posting function, idempotent by the draft (S03 "API"): its
 * key is the draft id, a reversal's `reversal:<entry id>`. The draft becomes `posted` and its
 * files move to the entry, in the same transaction.
 */
export async function postDraft(
  tx: Transaction,
  draft: DraftRow,
  lines: readonly DraftLine[],
  actor: PersonActor,
  options: { today: string; approvedByUserId: string | null },
): Promise<PostedEntryRef> {
  const entry = await post(tx, {
    client: 'manual',
    idempotencyKey: draft.reversesEntryId === null ? draft.id : `reversal:${draft.reversesEntryId}`,
    entryDate: draft.entryDate,
    description: draft.description as string,
    reference: draft.reference,
    draftId: draft.id,
    preparedByUserId: draft.preparedByUserId,
    approvedByUserId: options.approvedByUserId,
    actor,
    content: contentOf(draft, lines, options.today),
  });
  await tx
    .update(entryDrafts)
    .set({ state: 'posted', postedEntryId: entry.id })
    .where(eq(entryDrafts.id, draft.id));
  await tx
    .update(entryAttachments)
    .set({ entryId: entry.id })
    .where(and(eq(entryAttachments.draftId, draft.id), isNull(entryAttachments.archivedAt)));
  return entry;
}
