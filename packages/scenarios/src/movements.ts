import {
  type CurrencyCode,
  currencyCodeSchema,
  PROJECT_MOVEMENT_KINDS,
  recordMovementSchema,
} from '@vertex-mizan/contracts';
import { cancelMovement, projectMovements, recordMovement, withCompany } from '@vertex-mizan/db';
import { asc } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { advanceClock } from './clock.js';
import type { Step } from './format.js';
import type { CaseContext, StepResult } from './harness.js';
import { materialIdOf, valueIdOf } from './projects.js';
import { bookkeeperOf, outcomeOf } from './system.js';

/**
 * A movement step's payload (S13, ADR 0024), as the movement form sends it with codes for ids: the
 * kind, the project and supplier by code, the currency, the amount or a material with its quantity
 * and unit price.
 */
const movementPayloadSchema = z.strictObject({
  kind: z.enum(PROJECT_MOVEMENT_KINDS),
  contract: z.string().trim().min(1).optional(),
  supplier: z.string().trim().min(1).optional(),
  currency: currencyCodeSchema,
  amount: z.bigint().optional(),
  material: z.string().trim().min(1).optional(),
  quantity: z.string().optional(),
  unit_price: z.string().optional(),
});

/**
 * A movement (S13 rule 1) recorded and posted through `packages/db`'s `recordMovement()`, as the
 * API records it: its draft posted through its path in one transaction, dated the step's day.
 */
export async function movement(
  context: CaseContext,
  step: Extract<Step, { kind: 'movement' }>,
): Promise<StepResult> {
  const payload = movementPayloadSchema.parse(step.payload);
  advanceClock(context.companyId, step.accountingDate);
  return outcomeOf(
    withCompany(context.database.app, context.companyId, async (tx) => {
      const input = recordMovementSchema.parse({
        requestKey: uuidv7(),
        kind: payload.kind,
        date: step.accountingDate,
        projectId:
          payload.contract === undefined ? null : await valueIdOf(tx, 'contract', payload.contract),
        supplierId:
          payload.supplier === undefined ? null : await valueIdOf(tx, 'supplier', payload.supplier),
        currency: payload.currency as CurrencyCode,
        amountMinor: payload.amount === undefined ? null : payload.amount.toString(),
        material:
          payload.material === undefined
            ? null
            : {
                materialId: await materialIdOf(tx, payload.material),
                quantity: payload.quantity,
                unitPrice: payload.unit_price,
              },
        description: step.description,
      });
      await recordMovement(
        tx,
        {
          companyId: context.companyId,
          actor: bookkeeperOf(context.companyId),
          today: step.accountingDate,
        },
        input,
      );
    }),
  );
}

/**
 * A movement cancelled (S13 rule 8) through `packages/db`'s `cancelMovement()`, by its place among
 * the case's movements in the order they were recorded, on the step's day, with its reason.
 */
export async function cancelMovementStep(
  context: CaseContext,
  step: Extract<Step, { kind: 'cancel_movement' }>,
): Promise<StepResult> {
  advanceClock(context.companyId, step.accountingDate);
  return outcomeOf(
    withCompany(context.database.app, context.companyId, async (tx) => {
      const recorded = await tx
        .select({ id: projectMovements.id })
        .from(projectMovements)
        .orderBy(asc(projectMovements.createdAt), asc(projectMovements.id));
      const target = recorded[step.movement - 1];
      if (target === undefined) throw new TypeError(`No movement ${step.movement} in the case`);
      await cancelMovement(
        tx,
        {
          companyId: context.companyId,
          actor: bookkeeperOf(context.companyId),
          today: step.accountingDate,
        },
        target.id,
        { reason: step.reason },
      );
    }),
  );
}
