import { createHash } from 'node:crypto';
import {
  type CompanyLedgers,
  type CurrencyCode,
  canonicalPayload,
  DomainError,
  type ErrorCode,
  type ExchangeRate,
  type HubContractRef,
  type HubValueRef,
  type OpeningCheck,
  type OpeningSnapshot,
  type OpeningSnapshotResult,
  type OpeningState,
  openingSnapshotSchema,
  openingSnapshotTotals,
  type PostingSlot,
  type SaveOpening,
  slotAccountFits,
} from '@vertex-mizan/contracts';
import {
  canonicalJson,
  clientReference,
  dayBefore,
  debitTotals,
  type FigureDifference,
  hubItemFigure,
  type MissingRate,
  negate,
  type OpeningHubItem,
  type OpeningRateContext,
  type OpeningSchedule,
  openingFingerprintValue,
  openingHubItems,
  openingRecordLine,
  openingScheduleLine,
  openingSchedules,
  recordsDifferences,
  type ScheduleFailure,
  type SlotFigure,
  sumCarried,
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
import { apiClients } from '../schema/api-clients.js';
import { accountRoles, chartAccounts } from '../schema/chart.js';
import { companySettings } from '../schema/companies.js';
import { dimensionTypes, dimensionValues } from '../schema/dimensions.js';
import { postingRuleAccounts } from '../schema/inbox.js';
import { journalEntries, ledgerHeads } from '../schema/ledger.js';
import {
  openingLines,
  openingRecordFigures,
  openingSnapshots,
  openings,
} from '../schema/opening.js';
import { exchangeRates } from '../schema/rates.js';
import { recognitionMovements, recognitionSchedules } from '../schema/recognition.js';
import { onUniqueViolation } from '../unique-violation.js';
import { ledgersOf } from './companies.js';
import { HubValues } from './inbox.js';
import { exchangeRateOf, publicationCalendar, rateSuperseded } from './rates.js';
import { amountsOf } from './recognition.js';

// The opening balances (S10 rules 5–26, ADR 0019): Hub's snapshot as of the eve of the books start,
// the accountant's draft, its preview with the checks and the fingerprint, the owner's posting
// through `post()` and the whole reversal. Everything runs in the caller's transaction inside
// `withCompany`; `packages/ledger` computes, `post()` writes the ledger, this module writes the
// opening's rows, its schedules' movements and their audit.

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

/** Whether the company has a Hub client: an API client holding `events:write` or `opening:write`. */
export async function hasHubClient(tx: Transaction, companyId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: apiClients.id })
    .from(apiClients)
    .where(
      and(
        eq(apiClients.scopeCompanyId, companyId),
        isNull(apiClients.archivedAt),
        sql`${apiClients.scopes} && array['events:write', 'opening:write']::text[]`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Whether the books start is locked by a snapshot or an opening (S10 rule 2; a posted entry locks
 * it too, through the settings' own lock). `company_settings_books_start()` holds the same.
 */
export async function booksStartLocked(tx: Transaction): Promise<boolean> {
  const [snapshot] = await tx.select({ id: openingSnapshots.id }).from(openingSnapshots).limit(1);
  if (snapshot !== undefined) return true;
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

/** The latest snapshot by its receipt (S10 rule 7), parsed. */
async function latestSnapshot(tx: Transaction) {
  const [row] = await tx
    .select()
    .from(openingSnapshots)
    .orderBy(desc(openingSnapshots.receivedAt), desc(openingSnapshots.id))
    .limit(1);
  return row === undefined ? null : { row, snapshot: openingSnapshotSchema.parse(row.payload) };
}

/** The answer of a stored snapshot (S10 rule 9). */
function snapshotResult(
  row: typeof openingSnapshots.$inferSelect,
  snapshot: OpeningSnapshot,
  replayed: boolean,
): OpeningSnapshotResult {
  const { counts, totals } = openingSnapshotTotals(snapshot);
  return {
    snapshot_id: row.id,
    as_of: row.asOf,
    received_at: row.receivedAt.toISOString(),
    replayed,
    counts,
    totals,
  };
}

/** Every Hub reference a snapshot names, with its type, for the values made at receipt. */
function snapshotReferences(snapshot: OpeningSnapshot) {
  const dimensions: {
    client?: HubValueRef;
    contract?: HubContractRef;
    service?: HubValueRef;
    department?: HubValueRef;
  }[] = [];
  for (const invoice of snapshot.invoices) {
    dimensions.push({
      client: invoice.client,
      ...(invoice.contract && { contract: invoice.contract }),
    });
    for (const line of invoice.lines) {
      dimensions.push({ service: line.service });
      if (line.service.department !== undefined)
        dimensions.push({ department: line.service.department });
    }
  }
  for (const credit of snapshot.credits) {
    dimensions.push({
      client: credit.client,
      contract: credit.contract,
      service: credit.line.service,
    });
  }
  for (const milestone of snapshot.milestones) {
    dimensions.push({ client: milestone.client, contract: milestone.project });
    if (milestone.service !== undefined) dimensions.push({ service: milestone.service });
  }
  for (const wallet of snapshot.wallets) dimensions.push({ client: wallet.client });
  return dimensions;
}

/**
 * `POST /v1/opening/snapshot` (S10 rules 5–9): Hub's snapshot as of the eve, stored once per API
 * client and key. The same key and body answer the first result (`replayed`); another body under
 * the key is `IDEMPOTENCY_CONFLICT`; a company without a books start `NO_BOOKS_START`; an `as_of`
 * other than the eve `VALIDATION_FAILED`; after posting `OPENING_POSTED`. Hub's values are found or
 * made as an event's are (S05 rule 23), and `opening.snapshot_received` is audited with the counts
 * and totals.
 */
export async function receiveOpeningSnapshot(
  tx: Transaction,
  input: {
    readonly companyId: string;
    readonly apiClientId: string;
    readonly snapshotKey: string;
    readonly snapshot: OpeningSnapshot;
    readonly actor: AuditActor;
  },
): Promise<OpeningSnapshotResult> {
  // Two snapshots at once serialise on the company's settings row, the books start's (rules 2, 7):
  // the second finds the first's key, and Hub's values are made once.
  await tx.select({ id: companySettings.id }).from(companySettings).for('update');
  const settings = await settingsOf(tx);
  const payload = JSON.parse(canonicalPayload(input.snapshot)) as Record<string, unknown>;
  const payloadHash = sha256(canonicalPayload(input.snapshot));
  const [earlier] = await tx
    .select()
    .from(openingSnapshots)
    .where(
      and(
        eq(openingSnapshots.apiClientId, input.apiClientId),
        eq(openingSnapshots.snapshotKey, input.snapshotKey),
      ),
    );
  if (earlier !== undefined) {
    if (earlier.payloadHash !== payloadHash) {
      refuse('IDEMPOTENCY_CONFLICT', 'The key was used with another snapshot', {
        idempotencyKey: input.snapshotKey,
      });
    }
    return snapshotResult(earlier, openingSnapshotSchema.parse(earlier.payload), true);
  }
  if (input.snapshot.as_of !== settings.asOf) {
    refuse('VALIDATION_FAILED', 'A snapshot is as of the eve of the books start', {
      fields: [{ path: 'as_of', message: `Expected ${settings.asOf}` }],
    });
  }
  const posted = await tx
    .select({ id: openings.id })
    .from(openings)
    .where(eq(openings.state, 'posted'))
    .limit(1);
  if (posted.length > 0) refuse('OPENING_POSTED', 'The opening is posted');
  const values = new HubValues(tx, input.companyId, input.actor);
  for (const dimensions of snapshotReferences(input.snapshot)) await values.idsOf(dimensions);
  const { counts, totals } = openingSnapshotTotals(input.snapshot);
  const [row] = await tx
    .insert(openingSnapshots)
    .values({
      companyId: input.companyId,
      apiClientId: input.apiClientId,
      snapshotKey: input.snapshotKey,
      asOf: input.snapshot.as_of,
      generatedAt: new Date(input.snapshot.generated_at),
      payload,
      payloadHash,
      invoiceCount: counts.invoices,
      walletCount: counts.wallets,
      milestoneCount: counts.milestones,
      priorDocumentCount: counts.prior_documents,
    })
    // Two requests under one key at once (Hub's retry): the second waits for the first and stores
    // nothing, then answers it as a replay, or a conflict for another body (rule 7).
    .onConflictDoNothing({
      target: [
        openingSnapshots.companyId,
        openingSnapshots.apiClientId,
        openingSnapshots.snapshotKey,
      ],
    })
    .returning();
  if (!row) {
    const [first] = await tx
      .select()
      .from(openingSnapshots)
      .where(
        and(
          eq(openingSnapshots.apiClientId, input.apiClientId),
          eq(openingSnapshots.snapshotKey, input.snapshotKey),
        ),
      );
    if (!first) throw new Error('A snapshot neither stored nor found');
    if (first.payloadHash !== payloadHash) {
      refuse('IDEMPOTENCY_CONFLICT', 'The key was used with another snapshot', {
        idempotencyKey: input.snapshotKey,
      });
    }
    return snapshotResult(first, openingSnapshotSchema.parse(first.payload), true);
  }
  await writeCompanyAudit(tx, input.companyId, input.actor, {
    action: 'opening.snapshot_received',
    entityType: 'opening_snapshot',
    entityId: row.id,
    after: { snapshotKey: input.snapshotKey, asOf: row.asOf, counts, totals },
  });
  return snapshotResult(row, input.snapshot, false);
}

/** A Hub reference's value in the books: found by its Hub id, never made on a read. */
interface FoundValue {
  readonly id: string;
  readonly archived: boolean;
}

/** The values of Hub's references by type and Hub id (S02 rule 11), as they stand. */
async function hubValuesOf(tx: Transaction): Promise<Map<string, FoundValue>> {
  const rows = await tx
    .select({
      id: dimensionValues.id,
      type: dimensionTypes.code,
      externalId: dimensionValues.externalId,
      archivedAt: dimensionValues.archivedAt,
    })
    .from(dimensionValues)
    .innerJoin(
      dimensionTypes,
      and(
        eq(dimensionTypes.companyId, dimensionValues.companyId),
        eq(dimensionTypes.id, dimensionValues.typeId),
      ),
    )
    .where(eq(dimensionValues.externalSource, 'hub'));
  return new Map(
    rows.map((row) => [
      `${row.type}:${row.externalId}`,
      { id: row.id, archived: row.archivedAt !== null },
    ]),
  );
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

/** The opening's slots (S10 rule 11) as the snapshot needs them, and the two roles (rule 21). */
const OPENING_SLOTS: Readonly<
  Record<'receivable' | 'contract_asset' | 'ad_funds' | 'contract_liability', PostingSlot>
> = {
  receivable: 'receivable',
  contract_asset: 'contract_asset',
  ad_funds: 'ad_funds',
  contract_liability: 'contract_liability',
};

/** A failing check with what fails it (S10 rules 21–22). */
export interface CheckResult {
  readonly check: OpeningCheck;
  readonly passed: boolean;
  readonly failures: readonly Record<string, unknown>[];
}

/** A preview line with where it comes from (S10 rule 20). */
export interface OpeningPreviewLine extends PreviewLine {
  readonly source: 'hub' | 'schedule' | 'records' | 'balancing';
}

/** The opening as `GET /api/opening` reads it (S10 rule 20), in the books' own types. */
export interface OpeningView {
  readonly booksStart: string;
  readonly asOf: string;
  readonly hubClient: boolean;
  /** The live opening (a draft or posted), or null before the first save. */
  readonly opening: OpeningRow | null;
  /** The latest reversed opening, whose lines a new draft starts from. */
  readonly reversed: OpeningRow | null;
  /** The draft's version: 0 before the first save. */
  readonly version: number;
  readonly snapshot: {
    readonly id: string;
    readonly receivedAt: Date;
    readonly result: OpeningSnapshotResult;
  } | null;
  readonly hubItems: readonly OpeningHubItem[];
  readonly schedules: readonly OpeningSchedule[];
  readonly recordLines: readonly (typeof openingLines.$inferSelect)[];
  readonly recordFigures: readonly (typeof openingRecordFigures.$inferSelect)[];
  readonly differences: readonly FigureDifference[];
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

/** The lines and figures of a version of an opening. */
async function versionRows(tx: Transaction, opening: OpeningRow | null) {
  if (opening === null) return { lines: [], figures: [] };
  const lines = await tx
    .select()
    .from(openingLines)
    .where(and(eq(openingLines.openingId, opening.id), eq(openingLines.version, opening.version)))
    .orderBy(asc(openingLines.lineNo));
  const figures = await tx
    .select()
    .from(openingRecordFigures)
    .where(
      and(
        eq(openingRecordFigures.openingId, opening.id),
        eq(openingRecordFigures.version, opening.version),
      ),
    )
    .orderBy(asc(openingRecordFigures.id));
  return { lines, figures };
}

/**
 * The opening's preview (S10 rules 11–22): Hub's part from the latest snapshot and the accountant's
 * lines measured by `packages/ledger`, the records' comparison, each check computed now (nothing
 * stored, rule 22), the entry `post()` would post (its own preview, no write) and the fingerprint of
 * the snapshot, the draft's version and the rates through the eve.
 */
export async function readOpening(tx: Transaction): Promise<OpeningView> {
  const settings = await settingsOf(tx);
  const ledgers: CompanyLedgers = ledgersOf(settings);
  const { asOf, booksStart } = settings;
  const companyId = settings.companyId;
  const hubClient = await hasHubClient(tx, companyId);
  const opening = await liveOpening(tx, false);
  const reversed = opening === null ? await lastReversed(tx) : null;
  const { lines: recordLines, figures: recordFigures } = await versionRows(tx, opening ?? reversed);
  const latest = await latestSnapshot(tx);
  const snapshot =
    opening?.state === 'posted' && opening.snapshotId !== null
      ? await snapshotById(tx, opening.snapshotId)
      : latest;
  const { rates, ids: rateIds } = await ratesThrough(tx, asOf);
  const context: OpeningRateContext = {
    ledgers,
    asOf,
    rates,
    calendar: await publicationCalendar(tx, settings.bulletinDaysOff),
  };
  const empty = { invoices: [], credits: [], milestones: [], wallets: [] };
  const parsed = snapshot?.snapshot ?? null;
  const hub = parsed === null ? { items: [], missingRates: [] } : openingHubItems(parsed, context);
  const scheduled =
    parsed === null
      ? { schedules: [], failures: [] as ScheduleFailure[], missingRates: [] as MissingRate[] }
      : openingSchedules(parsed, context);
  void empty;
  const missingRates: MissingRate[] = [...hub.missingRates, ...scheduled.missingRates];

  // The accounts the lines name, and the mapping.
  const accountIds = [...new Set(recordLines.map((line) => line.accountId))];
  const accounts =
    accountIds.length === 0
      ? []
      : await tx.select().from(chartAccounts).where(inArray(chartAccounts.id, accountIds));
  const mappingFailures: Record<string, unknown>[] = [];
  const slotRows = await tx
    .select({ slot: postingRuleAccounts.slot, account: chartAccounts })
    .from(postingRuleAccounts)
    .innerJoin(
      chartAccounts,
      and(
        eq(chartAccounts.companyId, postingRuleAccounts.companyId),
        eq(chartAccounts.id, postingRuleAccounts.accountId),
      ),
    )
    .where(isNull(postingRuleAccounts.archivedAt));
  const slotAccount = (slot: PostingSlot) => {
    const row = slotRows.find((candidate) => candidate.slot === slot);
    if (row === undefined) {
      mappingFailures.push({ slot, reason: 'slot_unmapped' });
      return null;
    }
    const { account } = row;
    const usable =
      account.blockedAt === null &&
      account.archivedAt === null &&
      slotAccountFits(slot, null, {
        kind: account.kind as 'postable',
        class: account.class as 'asset',
        isControl: account.isControl,
        itemKind: account.itemKind as 'document' | null,
        currency: account.currency,
        isMonetary: account.isMonetary,
      });
    if (!usable) {
      mappingFailures.push({ slot, reason: 'account_blocked', account: account.code });
      return null;
    }
    return account;
  };
  const slotIds = new Map<string, string | null>();
  for (const item of hub.items) {
    if (!slotIds.has(item.slot))
      slotIds.set(item.slot, slotAccount(OPENING_SLOTS[item.slot])?.id ?? null);
  }
  if (scheduled.schedules.length > 0) {
    slotIds.set('contract_liability', slotAccount('contract_liability')?.id ?? null);
  }
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
  // Hub's values, linked and not archived (S02 rule 13).
  const found = await hubValuesOf(tx);
  const hubValueId = (type: string, externalId: string): string | null => {
    const value = found.get(`${type}:${externalId}`);
    if (value === undefined || value.archived) {
      mappingFailures.push({
        value: `${type}:${externalId}`,
        reason: value === undefined ? 'value_unlinked' : 'value_archived',
      });
      return null;
    }
    return value.id;
  };
  const partiesOf = (
    client: HubValueRef,
    contract: HubContractRef | undefined,
  ): string[] | null => {
    const clientId = hubValueId('client', client.external_id);
    const contractId = contract === undefined ? null : hubValueId('contract', contract.external_id);
    if (clientId === null || (contract !== undefined && contractId === null)) return null;
    return contractId === null ? [clientId] : [clientId, contractId];
  };

  // The content `post()` posts, in rule 23's order: Hub's items, the schedules, the records.
  const specs: OpeningLineSpec[] = [];
  const sources: OpeningPreviewLine['source'][] = [];
  let complete = true;
  for (const item of hub.items) {
    const account = slotIds.get(item.slot) ?? null;
    const parties = partiesOf(item.client, item.contract);
    if (account === null || parties === null) {
      complete = false;
      continue;
    }
    specs.push({
      accountId: account,
      dimensionValueIds: item.slot === 'ad_funds' ? parties.slice(0, 1) : parties,
      currency: item.amount.currency,
      amountMinor: item.amount.amountMinor,
      memo: null,
      fromHub: true,
      ...(item.document !== null && {
        newItem: {
          reference: item.reference,
          dueOn: item.dueOn,
          documentDate: item.documentDate,
          hubDocument: {
            type: item.document.type,
            id: item.document.id.id,
            number: item.document.id.number,
          },
        },
      }),
    });
    sources.push('hub');
  }
  const scheduleParties: (string[] | null)[] = [];
  for (const schedule of scheduled.schedules) {
    const account = slotIds.get('contract_liability') ?? null;
    const parties = partiesOf(schedule.client, schedule.contract);
    const service = hubValueId('service', schedule.service.external_id);
    scheduleParties.push(parties === null || service === null ? null : [...parties, service]);
    if (account === null || parties === null || service === null) {
      complete = false;
      continue;
    }
    const line = openingScheduleLine(schedule, account);
    specs.push({
      accountId: account,
      dimensionValueIds: parties,
      currency: line.transaction.currency,
      amountMinor: line.transaction.amountMinor,
      memo: null,
      fromHub: true,
      stated: { bookMinor: line.bookMinor, parallelMinor: line.parallelMinor },
    });
    sources.push('schedule');
  }
  const lineFailures: Record<string, unknown>[] = [];
  for (const line of recordLines) {
    const account = accounts.find((candidate) => candidate.id === line.accountId);
    if (account === undefined) {
      lineFailures.push({ lineNo: line.lineNo, code: 'NOT_FOUND' });
      complete = false;
      continue;
    }
    // Checked on read as at save (rule 22): no revenue or expense line, and in a company with a
    // Hub client no line on Hub's slots, so no document is counted twice (rule 12).
    if (account.class === 'revenue' || account.class === 'expense') {
      lineFailures.push({
        lineNo: line.lineNo,
        code: 'VALIDATION_FAILED',
        reason: 'income_statement_account',
      });
      complete = false;
      continue;
    }
    if (
      hubClient &&
      slotRows.some(
        (row) =>
          row.account.id === account.id &&
          ['receivable', 'ad_funds', 'contract_asset'].includes(row.slot),
      )
    ) {
      lineFailures.push({ lineNo: line.lineNo, code: 'VALIDATION_FAILED', reason: 'hub_slot' });
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
      fromHub: false,
      ...(measured.line.kind === 'stated' && {
        stated: { bookMinor: measured.line.bookMinor, parallelMinor: measured.line.parallelMinor },
      }),
      ...(line.itemReference !== null &&
        account.itemKind === 'document' && {
          newItem: {
            reference: line.itemReference,
            dueOn: line.itemDueOn,
            documentDate: asOf,
            hubDocument: null,
          },
        }),
    });
    sources.push('records');
  }

  // The records' comparison (rule 15): Hub's items and the figures by client value and currency.
  const hubFigures: SlotFigure[] = hub.items.flatMap((item) => {
    const figure = hubItemFigure(item);
    if (figure === null) return [];
    const value = found.get(`client:${item.client.external_id}`);
    return [{ ...figure, client: value?.id ?? `hub:${item.client.external_id}` }];
  });
  const differences = recordsDifferences(
    hubFigures,
    recordFigures.map((figure) => ({
      slot: figure.slot as SlotFigure['slot'],
      client: figure.clientValueId,
      currency: figure.currency as CurrencyCode,
      amountMinor: figure.amountMinor,
    })),
  );

  const uniqueMissing = missingRates.filter(
    (rate, index) =>
      missingRates.findIndex(
        (other) =>
          other.ledger === rate.ledger &&
          other.from === rate.from &&
          other.to === rate.to &&
          other.on === rate.on,
      ) === index,
  );
  const earlyFailing =
    (hubClient && snapshot === null) ||
    uniqueMissing.length > 0 ||
    mappingFailures.length > 0 ||
    scheduled.failures.length > 0 ||
    !complete;
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
      lines = preview.map((line, index) => ({ ...line, source: sources[index] ?? 'balancing' }));
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
      check: 'snapshot',
      passed: !(hubClient && snapshot === null),
      failures: hubClient && snapshot === null ? [{ reason: 'snapshot_missing' }] : [],
    },
    {
      check: 'records_agree',
      passed: differences.length === 0,
      failures: differences.map((difference) => ({ ...difference })),
    },
    {
      check: 'rates',
      passed: uniqueMissing.length === 0,
      failures: uniqueMissing.map((rate) => ({ ...rate })),
    },
    { check: 'mappings', passed: mappingFailures.length === 0, failures: mappingFailures },
    {
      check: 'schedules',
      passed: scheduled.failures.length === 0,
      failures: scheduled.failures.map((failure) => ({ ...failure })),
    },
    { check: 'lines', passed: lineFailures.length === 0, failures: lineFailures },
  ];
  const fingerprint = sha256(
    canonicalJson(
      openingFingerprintValue({
        snapshotId: snapshot?.row.id ?? null,
        version: opening?.version ?? 0,
        rateIds,
      }),
    ),
  );
  void scheduleParties;
  return {
    booksStart,
    asOf,
    hubClient,
    opening,
    reversed,
    version: opening?.version ?? 0,
    snapshot:
      snapshot === null
        ? null
        : {
            id: snapshot.row.id,
            receivedAt: snapshot.row.receivedAt,
            result: snapshotResult(snapshot.row, snapshot.snapshot, false),
          },
    hubItems: hub.items,
    schedules: scheduled.schedules,
    recordLines,
    recordFigures,
    differences,
    lines,
    checks,
    fingerprint,
    content,
  };
}

async function snapshotById(tx: Transaction, id: string) {
  const [row] = await tx.select().from(openingSnapshots).where(eq(openingSnapshots.id, id));
  return row === undefined ? null : { row, snapshot: openingSnapshotSchema.parse(row.payload) };
}

/**
 * `PUT /api/opening` (S10 rule 16): the accountant's lines and the records' figures replace the
 * draft's as one write against its version (`OPENING_CHANGED` when another save came first),
 * making the opening at its first save and adding one to its version at each; refused after posting
 * (`OPENING_POSTED`). A line on Hub's slots in a company with a Hub client, or on the
 * retained-earnings account, is `VALIDATION_FAILED` (rules 12, 14). Audited `opening.saved`.
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
  const slots = await tx
    .select({ slot: postingRuleAccounts.slot, accountId: postingRuleAccounts.accountId })
    .from(postingRuleAccounts)
    .where(isNull(postingRuleAccounts.archivedAt));
  const hubSlotAccounts = new Set(
    slots
      .filter((row) => ['receivable', 'ad_funds', 'contract_asset'].includes(row.slot))
      .map((row) => row.accountId),
  );
  const retained = await tx
    .select({ accountId: accountRoles.accountId })
    .from(accountRoles)
    .where(and(eq(accountRoles.role, 'retained_earnings'), isNull(accountRoles.archivedAt)));
  const hubClient = await hasHubClient(tx, companyId);
  input.lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (!accounts.some((account) => account.id === line.accountId)) {
      refuse('NOT_FOUND', 'No such account', { accountId: line.accountId, lineNo });
    }
    if (hubClient && hubSlotAccounts.has(line.accountId)) {
      refuse('VALIDATION_FAILED', "Hub's snapshot is the only source of its slots", { lineNo });
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
  if (input.recordFigures.length > 0) {
    await tx.insert(openingRecordFigures).values(
      input.recordFigures.map((figure) => ({
        companyId,
        openingId: row.id,
        version: row.version,
        slot: figure.slot,
        clientValueId: figure.clientValueId,
        currency: figure.currency,
        amountMinor: BigInt(figure.amount),
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
      figureCount: input.recordFigures.length,
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
 * entry through `post()` (source `opening`, on the books start, key `opening:<id>`), the schedules
 * with their `deferred` and `before_opening` movements, the opening `posted` with the snapshot, and
 * `opening.posted` audited with the entry, the snapshot, the fingerprint and the totals per ledger.
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
  await writeOpeningSchedules(tx, view, live, entry.id);
  await tx
    .update(openings)
    .set({
      state: 'posted',
      entryId: entry.id,
      snapshotId: view.snapshot?.id ?? null,
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
      snapshotId: view.snapshot?.id ?? null,
      fingerprint: view.fingerprint,
      bookDebitMinor: totals.bookMinor.toString(),
      parallelDebitMinor: totals.parallelMinor === null ? null : totals.parallelMinor.toString(),
    },
  });
  return { openingId: live.id, entry };
}

/**
 * The schedules of the opening (S10 rule 13), in the order of their lines, with Hub's values: each
 * its `deferred` movement, a `before_opening` movement per month released through the eve and one
 * with the credits' part, all on the opening entry.
 */
async function writeOpeningSchedules(
  tx: Transaction,
  view: OpeningView,
  opening: OpeningRow,
  entryId: string,
): Promise<void> {
  if (view.schedules.length === 0) return;
  const found = await hubValuesOf(tx);
  const idOf = (type: string, externalId: string) => {
    const value = found.get(`${type}:${externalId}`);
    if (value === undefined) throw new Error('A schedule value not found after the checks');
    return value.id;
  };
  const [slot] = await tx
    .select({ accountId: postingRuleAccounts.accountId })
    .from(postingRuleAccounts)
    .where(
      and(
        eq(postingRuleAccounts.slot, 'contract_liability'),
        isNull(postingRuleAccounts.archivedAt),
      ),
    );
  if (!slot) throw new Error('The contract liability slot is not mapped after the checks');
  for (const schedule of view.schedules) {
    const { line } = schedule;
    const [row] = await tx
      .insert(recognitionSchedules)
      .values({
        companyId: opening.companyId,
        openingId: opening.id,
        invoiceDocumentId: schedule.invoice.id,
        invoiceNumber: schedule.invoice.number,
        lineId: line.id,
        pattern: schedule.pattern,
        lineSource: line.source,
        chargeKind:
          line.source === 'retainer_charge' ? (line.charge_kind as 'monthly' | 'addition') : null,
        serviceFrom: schedule.serviceFrom,
        serviceTo: schedule.serviceTo,
        milestoneId: schedule.milestoneId,
        cycleKey: schedule.cycleKey,
        clientValueId: idOf('client', schedule.client.external_id),
        contractValueId:
          schedule.contract === undefined ? null : idOf('contract', schedule.contract.external_id),
        serviceValueId: idOf('service', schedule.service.external_id),
        liabilityAccountId: slot.accountId,
        currency: schedule.remaining.transaction.currency,
      })
      .returning({ id: recognitionSchedules.id });
    if (!row) throw new Error('The schedule was not made');
    const movement = (
      kind: 'deferred' | 'before_opening',
      amounts: OpeningSchedule['deferred'],
      month: string | null,
      creditMinor: bigint | null,
    ) => ({
      companyId: opening.companyId,
      scheduleId: row.id,
      kind,
      month: month === null ? null : `${month}-01`,
      entryId,
      transactionMinor: amounts.transaction.amountMinor,
      bookMinor: amounts.bookMinor,
      parallelMinor: amounts.parallelMinor,
      creditMinor,
    });
    const rows = [
      movement('deferred', schedule.deferred, null, null),
      ...schedule.releases.map((release) =>
        movement('before_opening', release.amounts, release.month, null),
      ),
      ...(schedule.creditLiability === null
        ? []
        : [movement('before_opening', schedule.creditLiability, null, schedule.creditMinor)]),
    ];
    // One at a time: the movement guard reads the schedule's earlier movements.
    for (const value of rows) await tx.insert(recognitionMovements).values(value);
  }
}

/**
 * `POST /api/opening/reverse` (S10 rule 25): while the opening entry is the company's only entry,
 * its exact negation on the books start through `post()`, each schedule given a `reversed`
 * movement of what it holds, the opening `reversed` with the reason, and `opening.reversed`
 * audited; otherwise `OPENING_NOT_REVERSIBLE`.
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
  const schedules = await tx
    .select({ id: recognitionSchedules.id, currency: recognitionSchedules.currency })
    .from(recognitionSchedules)
    .where(eq(recognitionSchedules.openingId, live.id))
    .orderBy(asc(recognitionSchedules.createdAt), asc(recognitionSchedules.id));
  for (const schedule of schedules) {
    const movements = await tx
      .select()
      .from(recognitionMovements)
      .where(eq(recognitionMovements.scheduleId, schedule.id));
    const currency = movements[0]?.transactionMinor === undefined ? null : schedule.currency;
    if (currency === null) continue;
    const back = negate(
      sumCarried(
        movements.map((movement) => amountsOf(movement, currency as CurrencyCode)),
        currency as CurrencyCode,
        movements.some((movement) => movement.parallelMinor !== null),
      ),
    );
    await tx.insert(recognitionMovements).values({
      companyId: live.companyId,
      scheduleId: schedule.id,
      kind: 'reversed',
      month: null,
      entryId: entry.id,
      transactionMinor: back.transaction.amountMinor,
      bookMinor: back.bookMinor,
      parallelMinor: back.parallelMinor,
    });
  }
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

/** The ad funds item's reference of a client, as the opening opens it (S10 rule 11). */
export const openingClientReference = clientReference;
