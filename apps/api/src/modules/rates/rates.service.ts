import { Inject, Injectable } from '@nestjs/common';
import type {
  AddBulletinHoliday,
  BulletinHoliday,
  CreateRatePair,
  CurrencyCode,
  ExchangeRate,
  RateCalendar,
  RateInForce,
  RateInForceQuery,
  RatePage,
  RatePair,
  RateQuery,
  RateRow,
  RateType,
  RecordedRate,
  RecordRate,
} from '@vertex-mizan/contracts';
import {
  bulletinHolidays,
  companySettings,
  type Database,
  exchangeRates,
  ratePairs,
  type Transaction,
  users,
  withCompany,
} from '@vertex-mizan/db';
import { lastPublicationDay, type PublicationCalendar, policyRate } from '@vertex-mizan/ledger';
import { and, asc, desc, eq, gte, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { type AuditActor, writeCompanyAudit } from '../../core/audit/audit.js';
import { DATABASE } from '../../core/database/database.module.js';
import { onUniqueViolation } from '../../core/database/unique-violation.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { decodeCursor, pageOf } from '../../core/http/cursor.js';

type StoredRate = typeof exchangeRates.$inferSelect;
type PairRow = typeof ratePairs.$inferSelect;

/** A page of rate rows: about two a day per pair (S02 "Volume and performance"). */
const PAGE_SIZE = 100;

/**
 * A stored `numeric(22,10)` rate as the money module takes it: the same exact value without the
 * padding zeros the column adds ("120.0000000000" is "120").
 */
export function rateText(stored: string): string {
  if (!stored.includes('.')) return stored;
  return stored.replace(/0+$/, '').replace(/\.$/, '');
}

function sameRate(a: string, b: string): boolean {
  return rateText(a) === rateText(b);
}

function pairOf(row: PairRow): RatePair {
  return {
    id: row.id,
    base: row.base as CurrencyCode,
    quote: row.quote as CurrencyCode,
    createdAt: row.createdAt.toISOString(),
  };
}

function exchangeRateOf(row: StoredRate): ExchangeRate {
  return {
    effectiveOn: row.effectiveOn,
    base: row.base as CurrencyCode,
    quote: row.quote as CurrencyCode,
    rate: rateText(row.rate),
    type: row.type as RateType,
    source: row.source as ExchangeRate['source'],
  };
}

/** The two currencies either way round. */
function eitherWay(a: CurrencyCode, b: CurrencyCode) {
  return or(
    and(eq(exchangeRates.base, a), eq(exchangeRates.quote, b)),
    and(eq(exchangeRates.base, b), eq(exchangeRates.quote, a)),
  );
}

/** The company rate table and the bulletin publication calendar (S02 rules 14–18). */
@Injectable()
export class RatesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `GET /api/rate-pairs`. */
  async pairs(access: CompanyRouteAccess): Promise<RatePair[]> {
    return withCompany(this.db, access.company.id, async (tx) => {
      const rows = await tx
        .select()
        .from(ratePairs)
        .orderBy(asc(ratePairs.base), asc(ratePairs.quote));
      return rows.map(pairOf);
    });
  }

  /**
   * `POST /api/rate-pairs`: two currencies in the orientation their rates will use; the reverse
   * of a held pair is refused (`RATE_ORIENTATION`, ADR 0011), the same pair answered as it is.
   */
  async createPair(access: CompanyRouteAccess, input: CreateRatePair): Promise<RatePair> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      return pairOf(await this.pairFor(tx, companyId, input.base, input.quote, actorOf(access)));
    });
  }

  /** `GET /api/rates`: rows newest first, with who recorded each and whether it was corrected. */
  async rates(access: CompanyRouteAccess, query: RateQuery): Promise<RatePage> {
    return withCompany(this.db, access.company.id, async (tx) => {
      const after = query.cursor ? decodeCursor(query.cursor) : null;
      const rows = await this.readRows(tx, [
        query.base ? eq(exchangeRates.base, query.base) : undefined,
        query.quote ? eq(exchangeRates.quote, query.quote) : undefined,
        query.type ? eq(exchangeRates.type, query.type) : undefined,
        query.from ? gte(exchangeRates.effectiveOn, query.from) : undefined,
        query.to ? lte(exchangeRates.effectiveOn, query.to) : undefined,
        after
          ? or(
              lt(exchangeRates.createdAt, after.createdAt),
              and(eq(exchangeRates.createdAt, after.createdAt), lt(exchangeRates.id, after.id)),
            )
          : undefined,
      ]);
      const page = pageOf(rows, PAGE_SIZE, (row) => row.entry);
      return { rates: page.entries, nextCursor: page.nextCursor };
    });
  }

  /**
   * `GET /api/rates/in-force` (rule 16, ADR 0007): the rate of a type converting `from` into `to`
   * on a date: the direct row or a cross through the company's other ledger currency, whichever is
   * more recent, under the bulletin's publication calendar. None answers `RATE_MISSING` with the
   * publication day *P* the bulletin would need.
   */
  async inForce(access: CompanyRouteAccess, query: RateInForceQuery): Promise<RateInForce> {
    return withCompany(this.db, access.company.id, async (tx) => {
      const [settings] = await tx.select().from(companySettings);
      if (!settings) throw new CodedException('NOT_FOUND', 'No company settings');
      const calendar = await this.publicationCalendar(tx, settings.bulletinDaysOff);
      const via = this.viaOf(query, settings.bookCurrency, settings.parallelCurrency);
      const legs: [CurrencyCode, CurrencyCode][] = [[query.from, query.to]];
      if (via !== null) legs.push([query.from, via], [via, query.to]);
      const newest = new Map<ExchangeRate, RateRow>();
      for (const [a, b] of legs) {
        // Only the newest row of a pair can be in force: the head of its date's correction chain.
        const [row] = await this.readRows(
          tx,
          [
            eq(exchangeRates.type, query.type),
            eitherWay(a, b),
            lte(exchangeRates.effectiveOn, query.on),
          ],
          'effective',
          1,
        );
        if (row) newest.set(exchangeRateOf(row.stored), row.entry);
      }
      const found = policyRate([...newest.keys()], { ...query, via }, calendar);
      if (found === null) {
        const publicationDay =
          query.type === 'bulletin' ? lastPublicationDay(query.on, calendar) : null;
        throw new CodedException(
          'RATE_MISSING',
          `No ${query.type} rate from ${query.from} to ${query.to} on ${query.on}`,
          undefined,
          publicationDay === null ? undefined : { publicationDay },
        );
      }
      const rows = 'legs' in found ? [...found.legs] : [found];
      return {
        rows: rows.map((rate) => newest.get(rate) as RateRow),
        via: 'legs' in found ? via : null,
      };
    });
  }

  /**
   * `POST /api/rates` (rules 14–15): a manual row. The first rate of two currencies makes their
   * pair; the reverse orientation is refused (`RATE_ORIENTATION`). A second row for a pair, type
   * and date is a correction: it needs a reason (`RATE_REASON_REQUIRED`) and supersedes the last
   * row of that date. A rate equal to the one in force for that date is refused first
   * (`RATE_UNCHANGED`), so a double submit gets that answer rather than a request for a reason.
   * The pair row is locked first, so two recordings of a pair run one after the other.
   */
  async record(access: CompanyRouteAccess, input: RecordRate): Promise<RecordedRate> {
    const companyId = access.company.id;
    const actor = actorOf(access);
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const pair = await this.pairFor(tx, companyId, input.base, input.quote, actor);
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
      const [previous] = await this.readRows(
        tx,
        [...sameDay, eq(exchangeRates.effectiveOn, input.effectiveOn)],
        'effective',
        1,
      );
      const [settings] = await tx.select().from(companySettings);
      const calendar = await this.publicationCalendar(tx, settings?.bulletinDaysOff ?? []);
      const [newest] = await this.readRows(
        tx,
        [...sameDay, lte(exchangeRates.effectiveOn, input.effectiveOn)],
        'effective',
        1,
      );
      const inForce = newest
        ? policyRate(
            [exchangeRateOf(newest.stored)],
            {
              type: input.type,
              from: input.base,
              to: input.quote,
              on: input.effectiveOn,
              via: null,
            },
            calendar,
          )
        : null;
      if (inForce !== null && !('legs' in inForce) && sameRate(inForce.rate, input.rate)) {
        throw new CodedException('RATE_UNCHANGED', 'The same rate is in force on that date');
      }
      if (previous && input.reason === undefined) {
        throw new CodedException('RATE_REASON_REQUIRED', 'A correction needs a reason');
      }
      if (!previous && input.reason !== undefined) {
        throw new CodedException('VALIDATION_FAILED', 'Nothing to correct on that date', [
          { path: ['reason'], message: 'The date has no rate to correct' },
        ]);
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
          recordedByUserId: access.person.id,
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
      const [recorded] = await this.readRows(tx, [eq(exchangeRates.id, row.id)]);
      const superseded = previous
        ? (await this.readRows(tx, [eq(exchangeRates.id, previous.stored.id)]))[0]
        : undefined;
      if (!recorded) throw new Error('The rate was not recorded');
      return { rate: recorded.entry, superseded: superseded?.entry ?? null };
    });
  }

  /** `GET /api/rate-calendar`: the weekly days off and the holidays in force, by date. */
  async calendar(access: CompanyRouteAccess): Promise<RateCalendar> {
    return withCompany(this.db, access.company.id, (tx) => this.readCalendar(tx));
  }

  /**
   * `PUT /api/rate-calendar` (rule 17): the weekly days off. A change affects postings from then
   * on; it is not part of the settings lock, since it decides which bulletin a future posting
   * needs, never a posted amount.
   */
  async updateCalendar(
    access: CompanyRouteAccess,
    daysOff: readonly number[],
  ): Promise<RateCalendar> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const [settings] = await tx.select().from(companySettings).for('update');
      if (!settings) throw new CodedException('NOT_FOUND', 'No company settings');
      const sorted = [...daysOff].sort((a, b) => a - b);
      const before = [...settings.bulletinDaysOff].sort((a, b) => a - b);
      if (JSON.stringify(sorted) !== JSON.stringify(before)) {
        await tx
          .update(companySettings)
          .set({ bulletinDaysOff: sorted })
          .where(eq(companySettings.id, settings.id));
        await writeCompanyAudit(tx, companyId, actorOf(access), {
          action: 'rate_calendar.updated',
          entityType: 'company_settings',
          entityId: settings.id,
          before: { bulletinDaysOff: before },
          after: { bulletinDaysOff: sorted },
        });
      }
      return this.readCalendar(tx);
    });
  }

  /** `POST /api/rate-calendar/holidays` (rule 17): a day with no bulletin, once (`HOLIDAY_EXISTS`). */
  async addHoliday(
    access: CompanyRouteAccess,
    input: AddBulletinHoliday,
  ): Promise<BulletinHoliday> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const [row] = await onUniqueViolation(
        () =>
          tx
            .insert(bulletinHolidays)
            .values({ companyId, holidayOn: input.on, note: input.note })
            .returning(),
        { bulletin_holidays_active_key: 'HOLIDAY_EXISTS' },
      );
      if (!row) throw new Error('The holiday was not added');
      await writeCompanyAudit(tx, companyId, actorOf(access), {
        action: 'bulletin_holiday.added',
        entityType: 'bulletin_holiday',
        entityId: row.id,
        after: { on: row.holidayOn, note: row.note },
      });
      return {
        id: row.id,
        on: row.holidayOn,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  /** `POST /api/rate-calendar/holidays/:id/remove`: archived, so the log keeps it. */
  async removeHoliday(access: CompanyRouteAccess, id: string): Promise<BulletinHoliday> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const [row] = await tx
        .select()
        .from(bulletinHolidays)
        .where(and(eq(bulletinHolidays.id, id), isNull(bulletinHolidays.archivedAt)))
        .for('no key update');
      if (!row) throw new CodedException('NOT_FOUND', 'No such holiday');
      await tx
        .update(bulletinHolidays)
        .set({ archivedAt: new Date() })
        .where(eq(bulletinHolidays.id, id));
      await writeCompanyAudit(tx, companyId, actorOf(access), {
        action: 'bulletin_holiday.removed',
        entityType: 'bulletin_holiday',
        entityId: id,
        before: { on: row.holidayOn, note: row.note, removed: false },
        after: { removed: true },
      });
      return {
        id: row.id,
        on: row.holidayOn,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  /**
   * The pair of two currencies, made in this orientation when neither exists (audited
   * `rate_pair.created`); the reverse orientation is `RATE_ORIENTATION`. Two first rates at once
   * insert one pair: the other finds it.
   */
  private async pairFor(
    tx: Transaction,
    companyId: string,
    base: CurrencyCode,
    quote: CurrencyCode,
    actor: AuditActor,
  ): Promise<PairRow> {
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
      throw new CodedException(
        'RATE_ORIENTATION',
        `The pair is held as ${held.base}/${held.quote}`,
      );
    }
    return held;
  }

  /** The other ledger currency to cross through (ADR 0007), when `to` is a ledger currency. */
  private viaOf(
    query: RateInForceQuery,
    book: string,
    parallel: string | null,
  ): CurrencyCode | null {
    const other = query.to === book ? parallel : query.to === parallel ? book : null;
    return other === null || other === query.from ? null : (other as CurrencyCode);
  }

  private async publicationCalendar(
    tx: Transaction,
    daysOff: readonly number[],
  ): Promise<PublicationCalendar> {
    const holidays = await tx
      .select({ on: bulletinHolidays.holidayOn })
      .from(bulletinHolidays)
      .where(isNull(bulletinHolidays.archivedAt));
    return { daysOff, holidays: holidays.map((holiday) => holiday.on) };
  }

  private async readCalendar(tx: Transaction): Promise<RateCalendar> {
    const [settings] = await tx.select().from(companySettings);
    const holidays = await tx
      .select()
      .from(bulletinHolidays)
      .where(isNull(bulletinHolidays.archivedAt))
      .orderBy(asc(bulletinHolidays.holidayOn));
    return {
      daysOff: [...(settings?.bulletinDaysOff ?? [])].sort((a, b) => a - b),
      holidays: holidays.map((row) => ({
        id: row.id,
        on: row.holidayOn,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Rate rows with who recorded each and whether a newer row corrects it. `recorded` orders newest
   * recorded first (the list). `effective` reads only the head of each date's correction chain (the
   * row no other row supersedes; one per pair, type and date) with the newest effective date first:
   * the row in force and the row a correction supersedes. The chain decides, never `created_at`,
   * which is the transaction's start and can disagree with the order two corrections took the
   * pair's lock in (S02 rules 15–16).
   */
  private async readRows(
    tx: Transaction,
    where: ReturnType<typeof and>[],
    order: 'recorded' | 'effective' = 'recorded',
    limit = PAGE_SIZE + 1,
  ): Promise<({ stored: StoredRate; entry: RateRow } & { createdAt: Date; id: string })[]> {
    const superseded = sql<boolean>`exists (select 1 from ${exchangeRates} as later where later.company_id = ${exchangeRates.companyId} and later.supersedes_rate_id = ${exchangeRates.id})`;
    const rows = await tx
      .select({ stored: exchangeRates, recorderName: users.name, superseded })
      .from(exchangeRates)
      .leftJoin(users, eq(users.id, exchangeRates.recordedByUserId))
      .where(and(...where, order === 'effective' ? sql`not ${superseded}` : undefined))
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
}
