import { DomainError, openingSnapshotSchema, saveOpeningSchema } from '@vertex-mizan/contracts';
import {
  apiClients,
  chartAccounts,
  dimensionTypes,
  dimensionValues,
  postOpening,
  readOpening,
  receiveOpeningSnapshot,
  reverseOpening,
  saveOpening,
  withCompany,
} from '@vertex-mizan/db';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Step } from './format.js';
import type { CaseContext, StepResult } from './harness.js';
import { advanceClock, hubActor, hubClientId, snapshotOf } from './hub.js';
import { bookkeeperOf, outcomeOf } from './system.js';

// The opening balances in the scenario book (S10 rules 5–25): Hub's snapshot received as
// `POST /v1/opening/snapshot` receives it, the accountant's draft saved, its preview read and
// posted by the owner with its fingerprint, and the whole reversal, through `packages/db`'s opening
// service as the API runs it.

type Transaction = Parameters<Parameters<typeof withCompany>[2]>[0];

/** The day before a date (`YYYY-MM-DD`). */
function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** The id of a value named by type and code (`client: C1`). */
async function valueIdOf(tx: Transaction, type: string, code: string): Promise<string> {
  const [value] = await tx
    .select({ id: dimensionValues.id })
    .from(dimensionValues)
    .innerJoin(
      dimensionTypes,
      and(
        eq(dimensionTypes.companyId, dimensionValues.companyId),
        eq(dimensionTypes.id, dimensionValues.typeId),
      ),
    )
    .where(and(eq(dimensionTypes.code, type), eq(dimensionValues.code, code)));
  if (!value) throw new Error(`The company has no ${type} value ${code}`);
  return value.id;
}

/**
 * Hub's API client of the case with `opening:write` (S10 rule 10): a company whose opening step
 * states a snapshot has a Hub client, one without has none. Made once, as the owner's API-client
 * screen makes it; the inbox's events are sent under the same id.
 */
async function ensureHubClient(context: CaseContext, userId: string): Promise<void> {
  const id = hubClientId(context.companyId);
  await context.database.app
    .insert(apiClients)
    .values({
      id,
      scopeCompanyId: context.companyId,
      name: 'Vertex Hub',
      system: 'hub',
      scopes: ['opening:write'],
      createdByUserId: userId,
    })
    .onConflictDoNothing();
}

/** The refusal of a step's service call, with an opening's failing checks as its detail. */
async function refusalOf(work: Promise<unknown>): Promise<StepResult> {
  try {
    await work;
    return { status: 'done' };
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    const checks = error.details?.checks;
    return Array.isArray(checks)
      ? { status: 'refused', reason: error.code, detail: checks.join(',') }
      : { status: 'refused', reason: error.code };
  }
}

/**
 * The `opening` step (S10 rules 5–23): the snapshot sent by Hub when the step states one, then the
 * draft saved with the step's lines and figures against its version, then its preview read and
 * posted by the owner with the preview's fingerprint, on the books start. A refused post leaves the
 * draft saved, so a later `opening` step replaces its lines and figures.
 */
export async function opening(
  context: CaseContext,
  step: Extract<Step, { kind: 'opening' }>,
): Promise<StepResult> {
  const { booksStart } = context.company;
  if (booksStart === null) throw new Error('An opening step needs the company books start');
  const actor = bookkeeperOf(context.companyId);
  advanceClock(context.companyId, booksStart);
  const asOf = dayBefore(booksStart);
  if (step.snapshot !== null) {
    await ensureHubClient(context, actor.userId);
    const snapshot = openingSnapshotSchema.parse(
      snapshotOf(context.companyId, asOf, step.snapshot),
    );
    const received = await refusalOf(
      withCompany(context.database.app, context.companyId, (tx) =>
        receiveOpeningSnapshot(tx, {
          companyId: context.companyId,
          apiClientId: hubClientId(context.companyId),
          snapshotKey: uuidv7(),
          snapshot,
          actor: hubActor(context),
        }),
      ),
    );
    if (received.status !== 'done') return received;
  }
  const saved = await outcomeOf(
    withCompany(context.database.app, context.companyId, async (tx) => {
      const accounts = new Map(
        (
          await tx.select({ id: chartAccounts.id, code: chartAccounts.code }).from(chartAccounts)
        ).map((row) => [row.code, row.id]),
      );
      const lines = [];
      for (const line of step.lines) {
        const dimensionValueIds = [];
        for (const [type, code] of Object.entries(line.dims)) {
          dimensionValueIds.push(await valueIdOf(tx, type, code));
        }
        lines.push({
          // An unknown code is the service's to refuse (`NOT_FOUND`).
          accountId: accounts.get(line.account) ?? uuidv7(),
          dimensionValueIds,
          currency: line.currency,
          amount: line.amount.toString(),
          book: line.book === null ? null : line.book.toString(),
          parallel: line.parallel === null ? null : line.parallel.toString(),
          itemReference: line.openItem?.ref ?? null,
          itemDueOn: line.openItem?.due ?? null,
          memo: line.memo,
        });
      }
      const recordFigures = [];
      for (const figure of step.figures) {
        recordFigures.push({
          slot: figure.slot,
          clientValueId: await valueIdOf(tx, 'client', figure.client),
          currency: figure.currency,
          amount: figure.amount.toString(),
        });
      }
      const view = await readOpening(tx);
      await saveOpening(
        tx,
        saveOpeningSchema.parse({ version: view.version, lines, recordFigures }),
        actor,
      );
    }),
  );
  if (saved.status !== 'done') return saved;
  return refusalOf(
    withCompany(context.database.app, context.companyId, async (tx) => {
      const view = await readOpening(tx);
      await postOpening(tx, { fingerprint: view.fingerprint, actor });
    }),
  );
}

/** The `reverse_opening` step (S10 rule 25): the owner's whole reversal, with its reason. */
export function reverse(
  context: CaseContext,
  step: Extract<Step, { kind: 'reverse_opening' }>,
): Promise<StepResult> {
  const actor = bookkeeperOf(context.companyId);
  return refusalOf(
    withCompany(context.database.app, context.companyId, (tx) =>
      reverseOpening(tx, { reason: step.reason, actor }),
    ),
  );
}
