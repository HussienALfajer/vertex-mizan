import { createHash } from 'node:crypto';
import {
  type CompanyLedgers,
  type CurrencyCode,
  DomainError,
  type ErrorCode,
  type ExchangeRate,
  type OpeningCheck,
  type OpeningState,
  type SaveOpening,
} from '@vertex-mizan/contracts';
import {
  canonicalJson,
  dayBefore,
  debitTotals,
  type MissingRate,
  type OpeningRateContext,
  openingFingerprintValue,
  openingRecordLine,
} from '@vertex-mizan/ledger';
import { and, asc, desc, eq, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { type AuditActor, writeCompanyAudit } from '../audit.js';
import type { Transaction } from '../client.js';
import {
  type OpeningLineSpec,
  type PostedEntryRef,
  type PreviewLine,
  post,
  previewPosting,
} from '../posting/post.js';
import { accountRoles, chartAccounts } from '../schema/chart.js';
import { companySettings } from '../schema/companies.js';
import { journalEntries, ledgerHeads } from '../schema/ledger.js';
import { openingLines, openings } from '../schema/opening.js';
import { exchangeRates } from '../schema/rates.js';
import { onUniqueViolation } from '../unique-violation.js';
import { ledgersOf } from './companies.js';
import { exchangeRateOf, publicationCalendar, rateSuperseded } from './rates.js';

// The opening balances (S10 rules 14–26, ADR 0019 as amended by ADR 0021): the accountant's
// draft, its preview with the checks and the fingerprint, the owner's posting through `post()` and
// the whole reversal. Everything runs in the caller's transaction inside `withCompany`;
// `packages/ledger` computes, `post()` writes the ledger, this module writes the opening's rows and
// their audit. Hub's snapshot, its schedules and the records' figures left with Hub.

type OpeningRow = typeof openings.$inferSelect;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function refuse(code: ErrorCode, message: string, details: Record<string, unknown> = {}): never {
  throw new DomainError(code, message, details);
}

/** The settings the opening reads; `NO_BOOKS_START` without a books start (S10 rules 1, 8). */
async function settingsOf(tx: Transaction) {
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  if (settings.booksStart === null) {
    refuse('NO_BOOKS_START', 'The company has no books start');
  }
  return { ...settings, booksStart: settings.booksStart, asOf: dayBefore(settings.booksStart) };
}

/**
 * Whether the books start is locked by an opening (S10 rule 2; a posted entry locks it too, through
 * the settings' own lock). `company_settings_books_start()` holds the same.
 */
export async function booksStartLocked(tx: Transaction): Promise<boolean> {
  const [opening] = await tx.select({ id: openings.id }).from(openings).limit(1);
  return opening !== undefined;
}

/** The company's live opening (a draft or posted), or null (S10 rule 10). */
async function liveOpening(tx: Transaction, lock: boolean): Promise<OpeningRow | null> {
  const query = tx.select().from(openings).where(ne(openings.state, 'reversed'));
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

/**
 * The state of the company's latest opening: the live one's, else the latest reversed one's, or
 * null before the first save (the company's `openingState`, S10).
 */
export async function openingStateOf(tx: Transaction): Promise<OpeningState | null> {
  const live = await liveOpening(tx, false);
  if (live !== null) return live.state as OpeningState;
  return (await lastReversed(tx)) === null ? null : 'reversed';
}

/** The latest reversed opening, whose lines a new draft starts from (S10 rule 25). */
async function lastReversed(tx: Transaction): Promise<OpeningRow | null> {
  const [row] = await tx
    .select()
    .from(openings)
    .where(eq(openings.state, 'reversed'))
    .orderBy(desc(openings.createdAt), desc(openings.id))
    .limit(1);
  return row ?? null;
}

/** The rate table as `packages/ledger` reads it, through the eve, with each row's id. */
async function ratesThrough(
  tx: Transaction,
  asOf: string,
): Promise<{ rates: ExchangeRate[]; ids: string[] }> {
  const rows = await tx
    .select()
    .from(exchangeRates)
    .where(and(lte(exchangeRates.effectiveOn, asOf), sql`not ${rateSuperseded}`))
    .orderBy(asc(exchangeRates.effectiveOn), asc(exchangeRates.createdAt), asc(exchangeRates.id));
  return { rates: rows.map((row) => exchangeRateOf(row)), ids: rows.map((row) => row.id) };
}

/** A failing check with what fails it (S10 rules 21–22). */
export interface CheckResult {
  readonly check: OpeningCheck;
  readonly passed: boolean;
  readonly failures: readonly Record<string, unknown>[];
}

/** A preview line with where it comes from (S10 rule 20). */
export interface OpeningPreviewLine extends PreviewLine {
  readonly source: 'records' | 'balancing';
}

/** The opening as `GET /api/opening` reads it (S10 rule 20), in the books' own types. */
export interface OpeningView {
  readonly booksStart: string;
  readonly asOf: string;
  /** The live opening (a draft or posted), or null before the first save. */
  readonly opening: OpeningRow | null;
  /** The latest reversed opening, whose lines a new draft starts from. */
  readonly reversed: OpeningRow | null;
  /** The draft's version: 0 before the first save. */
  readonly version: number;
  readonly recordLines: readonly (typeof openingLines.$inferSelect)[];
  /** The entry the draft would post now; empty while a check before `lines` fails. */
  readonly lines: readonly OpeningPreviewLine[];
  readonly checks: readonly CheckResult[];
  readonly fingerprint: string;
  /** The content `post()` would post, when it can be built. */
  readonly content: Extract<
    Parameters<typeof previewPosting>[1]['content'],
    { kind: 'opening' }
  > | null;
}

/** The lines of a version of an opening. */
async function versionLines(tx: Transaction, opening: OpeningRow | null) {
  if (opening === null) return [];
  return tx
    .select()
    .from(openingLines)
    .where(and(eq(openingLines.openingId, opening.id), eq(openingLines.version, opening.version)))
    .orderBy(asc(openingLines.lineNo));
}

/**
 * The opening's preview (S10 rules 14–22): the accountant's lines measured by `packages/ledger`,
 * each check computed now (nothing stored, rule 22), the entry `post()` would post (its own preview,
 * no write) and the fingerprint of the draft's version and the rates through the eve.
 */
export async function readOpening(tx: Transaction): Promise<OpeningView> {
  const settings = await settingsOf(tx);
  const ledgers: CompanyLedgers = ledgersOf(settings);
  const { asOf, booksStart } = settings;
  const opening = await liveOpening(tx, false);
  const reversed = opening === null ? await lastReversed(tx) : null;
  const recordLines = await versionLines(tx, opening ?? reversed);
  const { rates, ids: rateIds } = await ratesThrough(tx, asOf);
  const context: OpeningRateContext = {
    ledgers,
    asOf,
    rates,
    calendar: await publicationCalendar(tx, settings.bulletinDaysOff),
  };
  const missingRates: MissingRate[] = [];

  // The accounts the lines name, and the two roles (rule 21).
  const accountIds = [...new Set(recordLines.map((line) => line.accountId))];
  const accounts =
    accountIds.length === 0
      ? []
      : await tx.select().from(chartAccounts).where(inArray(chartAccounts.id, accountIds));
  const mappingFailures: Record<string, unknown>[] = [];
  const roles = await tx
    .select({ role: accountRoles.role, account: chartAccounts })
    .from(accountRoles)
    .innerJoin(
      chartAccounts,
      and(
        eq(chartAccounts.companyId, accountRoles.companyId),
        eq(chartAccounts.id, accountRoles.accountId),
      ),
    )
    .where(isNull(accountRoles.archivedAt));
  for (const role of ['retained_earnings', 'pre_opening_result'] as const) {
    const row = roles.find((candidate) => candidate.role === role);
    if (row === undefined) mappingFailures.push({ role, reason: 'role_missing' });
    else if (row.account.blockedAt !== null || row.account.archivedAt !== null) {
      mappingFailures.push({ role, reason: 'account_blocked', account: row.account.code });
    }
  }

  // The content `post()` posts, in rule 23's order: the records' lines, then the balancing line.
  const specs: OpeningLineSpec[] = [];
  let complete = true;
  const lineFailures: Record<string, unknown>[] = [];
  for (const line of recordLines) {
    const account = accounts.find((candidate) => candidate.id === line.accountId);
    if (account === undefined) {
      lineFailures.push({ lineNo: line.lineNo, code: 'NOT_FOUND' });
      complete = false;
      continue;
    }
    // Checked on read as at save (rule 22): no revenue or expense line.
    if (account.class === 'revenue' || account.class === 'expense') {
      lineFailures.push({
        lineNo: line.lineNo,
        code: 'VALIDATION_FAILED',
        reason: 'income_statement_account',
      });
      complete = false;
      continue;
    }
    const measured = openingRecordLine(
      {
        account: account.id,
        monetary: account.isMonetary,
        amount: { amountMinor: line.amountMinor, currency: line.currency as CurrencyCode },
        bookMinor: line.bookMinor,
        parallelMinor: line.parallelMinor,
      },
      context,
      missingRates,
    );
    if (measured.kind === 'incomplete') {
      lineFailures.push({
        lineNo: line.lineNo,
        code: 'STATED_AMOUNT_MISSING',
        ledger: measured.ledger,
      });
      complete = false;
      continue;
    }
    if (measured.kind === 'rate_missing') {
      complete = false;
      continue;
    }
    specs.push({
      accountId: account.id,
      dimensionValueIds: [...line.dimensionValueIds],
      currency: line.currency as CurrencyCode,
      amountMinor: line.amountMinor,
      memo: line.memo,
      ...(measured.line.kind === 'stated' && {
        stated: { bookMinor: measured.line.bookMinor, parallelMinor: measured.line.parallelMinor },
      }),
      ...(line.itemReference !== null &&
        account.itemKind === 'document' && {
          newItem: { reference: line.itemReference, dueOn: line.itemDueOn, documentDate: asOf },
        }),
    });
  }

  const earlyFailing = missingRates.length > 0 || mappingFailures.length > 0 || !complete;
  const content =
    earlyFailing || lineFailures.length > 0
      ? null
      : {
          kind: 'opening' as const,
          openingId: opening?.id ?? 'draft',
          measuredOn: asOf,
          lines: specs,
          today: booksStart,
        };
  let lines: OpeningPreviewLine[] = [];
  if (content !== null) {
    try {
      const preview = await previewPosting(tx, { entryDate: booksStart, content });
      lines = preview.map((line, index) => ({
        ...line,
        source: index < specs.length ? ('records' as const) : ('balancing' as const),
      }));
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      lineFailures.push({
        lineNo: error.details?.lineNo ?? null,
        code: error.code,
      });
    }
  }
  const checks: CheckResult[] = [
    {
      check: 'rates',
      passed: missingRates.length === 0,
      failures: missingRates.map((rate) => ({ ...rate })),
    },
    { check: 'mappings', passed: mappingFailures.length === 0, failures: mappingFailures },
    { check: 'lines', passed: lineFailures.length === 0, failures: lineFailures },
  ];
  const fingerprint = sha256(
    canonicalJson(openingFingerprintValue({ version: opening?.version ?? 0, rateIds })),
  );
  return {
    booksStart,
    asOf,
    opening,
    reversed,
    version: opening?.version ?? 0,
    recordLines,
    lines,
    checks,
    fingerprint,
    content,
  };
}

/**
 * `PUT /api/opening` (S10 rule 16): the accountant's lines replace the draft's as one write
 * against its version (`OPENING_CHANGED` when another save came first), making the opening at its
 * first save and adding one to its version at each; refused after posting (`OPENING_POSTED`). A
 * line on the retained-earnings account, or on a revenue or expense account, is
 * `VALIDATION_FAILED` (rule 14). Audited `opening.saved`.
 */
export async function saveOpening(
  tx: Transaction,
  input: SaveOpening,
  actor: Extract<AuditActor, { kind: 'person' }>,
): Promise<OpeningRow> {
  const settings = await settingsOf(tx);
  const companyId = settings.companyId;
  const opening = await liveOpening(tx, true);
  if (opening?.state === 'posted') refuse('OPENING_POSTED', 'The opening is posted');
  if ((opening?.version ?? 0) !== input.version) {
    refuse('OPENING_CHANGED', 'Another save came first', { version: opening?.version ?? 0 });
  }
  const accountIds = [...new Set(input.lines.map((line) => line.accountId))];
  const accounts =
    accountIds.length === 0
      ? []
      : await tx.select().from(chartAccounts).where(inArray(chartAccounts.id, accountIds));
  const retained = await tx
    .select({ accountId: accountRoles.accountId })
    .from(accountRoles)
    .where(and(eq(accountRoles.role, 'retained_earnings'), isNull(accountRoles.archivedAt)));
  input.lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (!accounts.some((account) => account.id === line.accountId)) {
      refuse('NOT_FOUND', 'No such account', { accountId: line.accountId, lineNo });
    }
    if (retained.some((row) => row.accountId === line.accountId)) {
      refuse('VALIDATION_FAILED', 'Retained earnings take the balancing figure', { lineNo });
    }
    const account = accounts.find((candidate) => candidate.id === line.accountId);
    if (account?.class === 'revenue' || account?.class === 'expense') {
      // The opening holds the balance sheet only; the result before the books start is one figure
      // on `pre_opening_result` (S10 "Accounting treatment"; owner, 2026-11-12).
      refuse('VALIDATION_FAILED', 'The opening holds no revenue or expense line', { lineNo });
    }
  });
  let row: OpeningRow;
  if (opening === null) {
    // Two first saves at once: the one live opening per company decides (rule 16).
    const [made] = await onUniqueViolation(
      () => tx.insert(openings).values({ companyId, preparedByUserId: actor.userId }).returning(),
      { openings_live_key: 'OPENING_CHANGED' },
    );
    if (!made) throw new Error('The opening was not made');
    row = made;
  } else {
    const [saved] = await tx
      .update(openings)
      .set({ version: opening.version + 1, preparedByUserId: actor.userId })
      .where(eq(openings.id, opening.id))
      .returning();
    if (!saved) throw new Error('The opening was not saved');
    row = saved;
  }
  if (input.lines.length > 0) {
    await tx.insert(openingLines).values(
      input.lines.map((line, index) => ({
        companyId,
        openingId: row.id,
        version: row.version,
        lineNo: index + 1,
        accountId: line.accountId,
        dimensionValueIds: [...line.dimensionValueIds].sort(),
        currency: line.currency,
        amountMinor: BigInt(line.amount),
        bookMinor: line.book === null ? null : BigInt(line.book),
        parallelMinor: line.parallel === null ? null : BigInt(line.parallel),
        itemReference: line.itemReference,
        itemDueOn: line.itemDueOn,
        memo: line.memo,
      })),
    );
  }
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'opening.saved',
    entityType: 'opening',
    entityId: row.id,
    after: {
      version: row.version,
      lineCount: input.lines.length,
    },
  });
  return row;
}

/** The posted opening entry. */
export interface PostedOpening {
  readonly openingId: string;
  readonly entry: PostedEntryRef;
}

/**
 * `POST /api/opening/post` (S10 rules 21, 23): under the ledger head's lock, the preview read again;
 * a fingerprint other than the posted one is `OPENING_CHANGED` with the new one; a failing check
 * `OPENING_CHECKS_FAILED` naming them in rule 21's order; a second post `OPENING_POSTED`. Then one
 * entry through `post()` (source `opening`, on the books start, key `opening:<id>`), the opening
 * `posted`, and `opening.posted` audited with the entry, the fingerprint and the totals per ledger.
 */
export async function postOpening(
  tx: Transaction,
  input: { readonly fingerprint: string; readonly actor: Extract<AuditActor, { kind: 'person' }> },
): Promise<PostedOpening> {
  await tx.select({ id: ledgerHeads.id }).from(ledgerHeads).for('update');
  const live = await liveOpening(tx, true);
  if (live?.state === 'posted') refuse('OPENING_POSTED', 'The opening is posted');
  if (live === null) refuse('VALIDATION_FAILED', 'Save the opening before posting it');
  const view = await readOpening(tx);
  if (view.fingerprint !== input.fingerprint) {
    refuse('OPENING_CHANGED', 'The opening changed since its preview', {
      fingerprint: view.fingerprint,
    });
  }
  const failing = view.checks.filter((check) => !check.passed).map((check) => check.check);
  if (failing.length > 0 || view.content === null) {
    refuse('OPENING_CHECKS_FAILED', 'A check of the opening fails', { checks: failing });
  }
  const content = { ...view.content, openingId: live.id };
  const entry = await post(tx, {
    client: 'manual',
    idempotencyKey: `opening:${live.id}`,
    entryDate: view.booksStart,
    description: 'قيد الأرصدة الافتتاحية',
    reference: null,
    draftId: null,
    preparedByUserId: live.preparedByUserId,
    approvedByUserId: null,
    actor: input.actor,
    content,
  });
  await tx
    .update(openings)
    .set({
      state: 'posted',
      entryId: entry.id,
      postedByUserId: input.actor.userId,
      postedAt: new Date(),
      fingerprint: view.fingerprint,
    })
    .where(eq(openings.id, live.id));
  const totals = debitTotals(view.lines);
  await writeCompanyAudit(tx, view.opening?.companyId ?? live.companyId, input.actor, {
    action: 'opening.posted',
    entityType: 'opening',
    entityId: live.id,
    after: {
      entryId: entry.id,
      fingerprint: view.fingerprint,
      bookDebitMinor: totals.bookMinor.toString(),
      parallelDebitMinor: totals.parallelMinor === null ? null : totals.parallelMinor.toString(),
    },
  });
  return { openingId: live.id, entry };
}

/**
 * `POST /api/opening/reverse` (S10 rule 25): while the opening entry is the company's only entry,
 * its exact negation on the books start through `post()`, the opening `reversed` with the reason,
 * and `opening.reversed` audited; otherwise `OPENING_NOT_REVERSIBLE`.
 */
export async function reverseOpening(
  tx: Transaction,
  input: { readonly reason: string; readonly actor: Extract<AuditActor, { kind: 'person' }> },
): Promise<{ readonly openingId: string; readonly entry: PostedEntryRef }> {
  await settingsOf(tx);
  await tx.select({ id: ledgerHeads.id }).from(ledgerHeads).for('update');
  const live = await liveOpening(tx, true);
  if (live === null || live.state !== 'posted' || live.entryId === null) {
    refuse('OPENING_NOT_REVERSIBLE', 'No posted opening to reverse');
  }
  const others = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(ne(journalEntries.id, live.entryId))
    .limit(1);
  if (others.length > 0) {
    refuse('OPENING_NOT_REVERSIBLE', 'The opening entry is no longer the only entry');
  }
  const [original] = await tx
    .select({ date: journalEntries.entryDate })
    .from(journalEntries)
    .where(eq(journalEntries.id, live.entryId));
  if (!original) throw new Error('An opening without its entry');
  const entry = await post(tx, {
    client: 'manual',
    idempotencyKey: `opening-reversal:${live.id}`,
    entryDate: original.date,
    description: 'عكس قيد الأرصدة الافتتاحية',
    reference: null,
    draftId: null,
    preparedByUserId: input.actor.userId,
    approvedByUserId: null,
    actor: input.actor,
    content: { kind: 'opening_reversal', entryId: live.entryId, today: original.date },
  });
  await tx
    .update(openings)
    .set({
      state: 'reversed',
      reversalEntryId: entry.id,
      reversedByUserId: input.actor.userId,
      reversedAt: new Date(),
      reverseReason: input.reason,
    })
    .where(eq(openings.id, live.id));
  await writeCompanyAudit(tx, live.companyId, input.actor, {
    action: 'opening.reversed',
    entityType: 'opening',
    entityId: live.id,
    before: { entryId: live.entryId },
    after: { reversalEntryId: entry.id, reason: input.reason },
  });
  return { openingId: live.id, entry };
}
