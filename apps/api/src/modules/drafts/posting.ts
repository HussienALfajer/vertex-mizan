import type { DomainError, DraftLine, PostingRefusal } from '@vertex-mizan/contracts';
import {
  companySettings,
  type DealtRateSpec,
  entryAttachments,
  entryDrafts,
  type ManualLineSpec,
  type PersonActor,
  type PostingContent,
  post,
  postVoucher,
  type Transaction,
  type VoucherSpec,
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
  // S11 rule 13: a count has no lines of its own, only the cash counted.
  if (draft.voucherKind === 'count') {
    if (draft.countedMinor === null) {
      refusals.push({
        code: 'VALIDATION_FAILED',
        message: 'A count states the cash counted',
        lineNo: null,
        details: { field: 'countedMinor' },
      });
    }
    return refusals;
  }
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
    lines: manualLinesOf(lines),
  };
}

/** A complete draft's lines as the posting function takes them. */
export function manualLinesOf(lines: readonly DraftLine[]): ManualLineSpec[] {
  return lines.map((line) => ({
    accountId: line.accountId as string,
    dimensionValueIds: line.dimensionValueIds,
    currency: line.currency as NonNullable<DraftLine['currency']>,
    amountMinor: BigInt(line.amountMinor as string),
    memo: line.memo,
    openItemId: line.openItemId,
    newItem: line.newItem,
  }));
}

/**
 * A voucher draft's header as the posting function takes it (S11 rules 9–13), with a count's
 * expected amount as its preview showed it; null for any other draft.
 */
export function voucherSpecOf(draft: DraftRow, expectedMinor: bigint | null): VoucherSpec | null {
  if (draft.voucherKind === null || draft.cashAccountId === null) return null;
  return {
    kind: draft.voucherKind,
    cashAccountId: draft.cashAccountId,
    counterCashAccountId: draft.counterCashAccountId,
    partyName: draft.partyName,
    countedMinor: draft.countedMinor,
    expectedMinor,
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
 * key is the draft id, a reversal's `reversal:<entry id>`. A voucher draft posts through
 * `postVoucher()` with its header and, for a count, the expected amount its preview showed (S11
 * rules 9–13). The draft becomes `posted` and its files move to the entry, in the same
 * transaction; a count that matched posts no entry, so its files stay with its draft. Answers the
 * entry's id, null for such a count.
 */
export async function postDraft(
  tx: Transaction,
  draft: DraftRow,
  lines: readonly DraftLine[],
  actor: PersonActor,
  options: { today: string; approvedByUserId: string | null; expectedMinor: bigint | null },
): Promise<string | null> {
  const request = {
    client: 'manual',
    idempotencyKey: draft.reversesEntryId === null ? draft.id : `reversal:${draft.reversesEntryId}`,
    entryDate: draft.entryDate,
    description: draft.description as string,
    reference: draft.reference,
    draftId: draft.id,
    preparedByUserId: draft.preparedByUserId,
    approvedByUserId: options.approvedByUserId,
    actor,
  };
  const voucher = voucherSpecOf(draft, options.expectedMinor);
  const entryId =
    voucher === null
      ? (await post(tx, { ...request, content: contentOf(draft, lines, options.today) })).id
      : ((
          await postVoucher(tx, {
            ...request,
            voucher,
            lines: voucher.kind === 'count' ? [] : manualLinesOf(lines),
            dealtRates: draft.dealtRates as DealtRateSpec[],
            today: options.today,
          })
        ).entry?.id ?? null);
  await tx
    .update(entryDrafts)
    .set({ state: 'posted', postedEntryId: entryId })
    .where(eq(entryDrafts.id, draft.id));
  if (entryId !== null) {
    await tx
      .update(entryAttachments)
      .set({ entryId })
      .where(and(eq(entryAttachments.draftId, draft.id), isNull(entryAttachments.archivedAt)));
  }
  return entryId;
}
