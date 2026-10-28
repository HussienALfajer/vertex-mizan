import {
  type AddBulletinHoliday,
  type CurrencyCode,
  DomainError,
  type ExchangeRate,
  type RateRow,
  type RateType,
  type RecordRate,
} from '@vertex-mizan/contracts';
import { type PublicationCalendar, policyRate } from '@vertex-mizan/ledger';
import { and, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { type AuditActor, writeCompanyAudit } from '../audit.js';
import type { Transaction } from '../client.js';
import { users } from '../schema/access.js';
import { companySettings } from '../schema/companies.js';
import { bulletinHolidays, exchangeRates, ratePairs } from '../schema/rates.js';
import { onUniqueViolation } from '../unique-violation.js';

// The rate table's writes that the API and the scenario book's setup share (S02 rules 14–17), in
// the caller's transaction and company context.

export type StoredRate = typeof exchangeRates.$inferSelect;
export type RatePairRow = typeof ratePairs.$inferSelect;
export type BulletinHolidayRow = typeof bulletinHolidays.$inferSelect;

/** A person who records a rate; Hub's own rates join with S05. */
export type PersonActor = Extract<AuditActor, { kind: 'person' }>;

/**
 * A stored `numeric(22,10)` rate as the money module takes it: the same exact value without the
 * padding zeros the column adds ("120.0000000000" is "120").
 */
export function rateText(stored: string): string {
  if (!stored.includes('.')) return stored;
  return stored.replace(/0+$/, '').replace(/\.$/, '');
}

/** A stored rate row as the money module and `packages/ledger` take it. */
export function exchangeRateOf(row: StoredRate): ExchangeRate {
  return {
    effectiveOn: row.effectiveOn,
    base: row.base as CurrencyCode,
    quote: row.quote as CurrencyCode,
    rate: rateText(row.rate),
    type: row.type as RateType,
    source: row.source as ExchangeRate['source'],
  };
}

/** Whether a rate row is superseded by a correction (S02 rule 15). */
export const rateSuperseded = sql<boolean>`exists (select 1 from ${exchangeRates} as later where later.company_id = ${exchangeRates.companyId} and later.supersedes_rate_id = ${exchangeRates.id})`;

/**
 * Rate rows with who recorded each and whether a newer row corrects it. `recorded` orders newest
 * recorded first (the list). `effective` reads only the head of each date's correction chain (the
 * row no other row supersedes; one per pair, type and date) with the newest effective date first:
 * the row in force and the row a correction supersedes. The chain decides, never `created_at`,
 * which is the transaction's start and can disagree with the order two corrections took the
 * pair's lock in (S02 rules 15–16).
 */
export async function readRateRows(
  tx: Transaction,
  where: ReturnType<typeof and>[],
  order: 'recorded' | 'effective',
  limit: number,
): Promise<({ stored: StoredRate; entry: RateRow } & { createdAt: Date; id: string })[]> {
  const rows = await tx
    .select({ stored: exchangeRates, recorderName: users.name, superseded: rateSuperseded })
    .from(exchangeRates)
    .leftJoin(users, eq(users.id, exchangeRates.recordedByUserId))
    .where(and(...where, order === 'effective' ? sql`not ${rateSuperseded}` : undefined))
    .orderBy(
      ...(order === 'effective' ? [desc(exchangeRates.effectiveOn)] : []),
      desc(exchangeRates.createdAt),
      desc(exchangeRates.id),
    )
    .limit(limit);
  return rows.map(({ stored, recorderName, superseded }) => ({
    stored,
    createdAt: stored.createdAt,
    id: stored.id,
    entry: {
      id: stored.id,
      effectiveOn: stored.effectiveOn,
      base: stored.base as CurrencyCode,
      quote: stored.quote as CurrencyCode,
      rate: rateText(stored.rate),
      type: stored.type as RateType,
      source: stored.source as RateRow['source'],
      supersedesRateId: stored.supersedesRateId,
      reason: stored.reason,
      recordedBy:
        stored.recordedByUserId !== null
          ? { kind: 'person', id: stored.recordedByUserId, name: recorderName ?? '' }
          : // An API client's name joins with S05's clients table.
            { kind: 'api_client', id: stored.recordedByApiClientId as string, name: 'Hub' },
      superseded: Boolean(superseded),
      createdAt: stored.createdAt.toISOString(),
    },
  }));
}

/** The company's bulletin publication calendar: its weekly days off and active holidays. */
export async function publicationCalendar(
  tx: Transaction,
  daysOff: readonly number[],
): Promise<PublicationCalendar> {
  const holidays = await tx
    .select({ on: bulletinHolidays.holidayOn })
    .from(bulletinHolidays)
    .where(isNull(bulletinHolidays.archivedAt));
  return { daysOff, holidays: holidays.map((holiday) => holiday.on) };
}

/**
 * The pair of two currencies, made in this orientation when neither exists (audited
 * `rate_pair.created`); the reverse orientation is `RATE_ORIENTATION`. Two first rates at once
 * insert one pair: the other finds it.
 */
export async function ratePairFor(
  tx: Transaction,
  companyId: string,
  base: CurrencyCode,
  quote: CurrencyCode,
  actor: AuditActor,
): Promise<RatePairRow> {
  const [inserted] = await tx
    .insert(ratePairs)
    .values({ companyId, base, quote })
    .onConflictDoNothing()
    .returning();
  if (inserted) {
    await writeCompanyAudit(tx, companyId, actor, {
      action: 'rate_pair.created',
      entityType: 'rate_pair',
      entityId: inserted.id,
      after: { base, quote },
    });
    return inserted;
  }
  const [held] = await tx
    .select()
    .from(ratePairs)
    .where(
      or(
        and(eq(ratePairs.base, base), eq(ratePairs.quote, quote)),
        and(eq(ratePairs.base, quote), eq(ratePairs.quote, base)),
      ),
    );
  if (!held) throw new Error('The pair was neither made nor found');
  if (held.base !== base) {
    throw new DomainError('RATE_ORIENTATION', `The pair is held as ${held.base}/${held.quote}`);
  }
  return held;
}

/**
 * Records a rate row (S02 rules 14–15): a first row of a pair, type and date, or a correction of
 * the row in force on that date, which needs a reason (`RATE_REASON_REQUIRED`) and supersedes it;
 * the same rate already in force is `RATE_UNCHANGED`. The pair row is locked first, so two
 * recordings of a pair run one after the other. Returns the new row and the row it corrects.
 */
export async function recordRate(
  tx: Transaction,
  companyId: string,
  actor: PersonActor,
  input: RecordRate,
): Promise<{ id: string; supersededId: string | null }> {
  const pair = await ratePairFor(tx, companyId, input.base, input.quote, actor);
  await tx
    .select({ id: ratePairs.id })
    .from(ratePairs)
    .where(eq(ratePairs.id, pair.id))
    .for('update');
  const sameDay = [
    eq(exchangeRates.base, input.base),
    eq(exchangeRates.quote, input.quote),
    eq(exchangeRates.type, input.type),
  ];
  const [previous] = await readRateRows(
    tx,
    [...sameDay, eq(exchangeRates.effectiveOn, input.effectiveOn)],
    'effective',
    1,
  );
  const [settings] = await tx.select().from(companySettings);
  const calendar = await publicationCalendar(tx, settings?.bulletinDaysOff ?? []);
  const [newest] = await readRateRows(
    tx,
    [...sameDay, lte(exchangeRates.effectiveOn, input.effectiveOn)],
    'effective',
    1,
  );
  const inForce = newest
    ? policyRate(
        [exchangeRateOf(newest.stored)],
        { type: input.type, from: input.base, to: input.quote, on: input.effectiveOn, via: null },
        calendar,
      )
    : null;
  if (inForce !== null && !('legs' in inForce) && rateText(inForce.rate) === rateText(input.rate)) {
    throw new DomainError('RATE_UNCHANGED', 'The same rate is in force on that date');
  }
  if (previous && input.reason === undefined) {
    throw new DomainError('RATE_REASON_REQUIRED', 'A correction needs a reason');
  }
  if (!previous && input.reason !== undefined) {
    throw new DomainError('VALIDATION_FAILED', 'Nothing to correct on that date', {
      issues: [{ path: ['reason'], message: 'The date has no rate to correct' }],
    });
  }
  const [row] = await tx
    .insert(exchangeRates)
    .values({
      companyId,
      effectiveOn: input.effectiveOn,
      base: input.base,
      quote: input.quote,
      rate: input.rate,
      type: input.type,
      source: 'manual',
      supersedesRateId: previous?.stored.id ?? null,
      reason: previous ? (input.reason ?? null) : null,
      recordedByUserId: actor.userId,
    })
    .returning({ id: exchangeRates.id });
  if (!row) throw new Error('The rate was not recorded');
  await writeCompanyAudit(tx, companyId, actor, {
    action: previous ? 'rate.corrected' : 'rate.recorded',
    entityType: 'exchange_rate',
    entityId: row.id,
    reason: previous ? (input.reason ?? null) : null,
    before: previous
      ? {
          rate: rateText(previous.stored.rate),
          supersedesRateId: previous.stored.supersedesRateId,
        }
      : null,
    after: {
      effectiveOn: input.effectiveOn,
      base: input.base,
      quote: input.quote,
      rate: input.rate,
      type: input.type,
      source: 'manual',
      supersedesRateId: previous?.stored.id ?? null,
    },
  });
  return { id: row.id, supersededId: previous?.stored.id ?? null };
}

/**
 * The weekly days off of the bulletin (S02 rule 17), audited when they change. The settings row is
 * locked first. They decide which bulletin a future posting needs, never a posted amount, so they
 * are not part of the settings lock.
 */
export async function setBulletinDaysOff(
  tx: Transaction,
  companyId: string,
  actor: AuditActor,
  daysOff: readonly number[],
): Promise<void> {
  const [settings] = await tx.select().from(companySettings).for('update');
  if (!settings) throw new DomainError('NOT_FOUND', 'No company settings');
  const sorted = [...daysOff].sort((a, b) => a - b);
  const before = [...settings.bulletinDaysOff].sort((a, b) => a - b);
  if (JSON.stringify(sorted) === JSON.stringify(before)) return;
  await tx
    .update(companySettings)
    .set({ bulletinDaysOff: sorted })
    .where(eq(companySettings.id, settings.id));
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'rate_calendar.updated',
    entityType: 'company_settings',
    entityId: settings.id,
    before: { bulletinDaysOff: before },
    after: { bulletinDaysOff: sorted },
  });
}

/** A day with no bulletin (S02 rule 17), once (`HOLIDAY_EXISTS`), audited. */
export async function addBulletinHoliday(
  tx: Transaction,
  companyId: string,
  actor: AuditActor,
  input: AddBulletinHoliday,
): Promise<BulletinHolidayRow> {
  const [row] = await onUniqueViolation(
    () =>
      tx
        .insert(bulletinHolidays)
        .values({ companyId, holidayOn: input.on, note: input.note })
        .returning(),
    { bulletin_holidays_active_key: 'HOLIDAY_EXISTS' },
  );
  if (!row) throw new Error('The holiday was not added');
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'bulletin_holiday.added',
    entityType: 'bulletin_holiday',
    entityId: row.id,
    after: { on: row.holidayOn, note: row.note },
  });
  return row;
}
