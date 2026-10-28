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
  RecordedRate,
  RecordRate,
} from '@vertex-mizan/contracts';
import {
  addBulletinHoliday,
  bulletinHolidays,
  companySettings,
  type Database,
  exchangeRateOf,
  exchangeRates,
  publicationCalendar,
  type RatePairRow,
  ratePairFor,
  ratePairs,
  readRateRows,
  recordRate,
  setBulletinDaysOff,
  type Transaction,
  withCompany,
} from '@vertex-mizan/db';
import { lastPublicationDay, policyRate } from '@vertex-mizan/ledger';
import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { writeCompanyAudit } from '../../core/audit/audit.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { afterCursor, decodeCursor, pageOf } from '../../core/http/cursor.js';

/** A page of rate rows: about two a day per pair (S02 "Volume and performance"). */
const PAGE_SIZE = 100;

export { rateText } from '@vertex-mizan/db';

function pairOf(row: RatePairRow): RatePair {
  return {
    id: row.id,
    base: row.base as CurrencyCode,
    quote: row.quote as CurrencyCode,
    createdAt: row.createdAt.toISOString(),
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
      return pairOf(await ratePairFor(tx, companyId, input.base, input.quote, actorOf(access)));
    });
  }

  /** `GET /api/rates`: rows newest first, with who recorded each and whether it was corrected. */
  async rates(access: CompanyRouteAccess, query: RateQuery): Promise<RatePage> {
    return withCompany(this.db, access.company.id, async (tx) => {
      const after = query.cursor ? decodeCursor(query.cursor) : null;
      const rows = await readRateRows(
        tx,
        [
          query.base ? eq(exchangeRates.base, query.base) : undefined,
          query.quote ? eq(exchangeRates.quote, query.quote) : undefined,
          query.type ? eq(exchangeRates.type, query.type) : undefined,
          query.from ? gte(exchangeRates.effectiveOn, query.from) : undefined,
          query.to ? lte(exchangeRates.effectiveOn, query.to) : undefined,
          after ? afterCursor(exchangeRates.createdAt, exchangeRates.id, after) : undefined,
        ],
        'recorded',
        PAGE_SIZE + 1,
      );
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
      const calendar = await publicationCalendar(tx, settings.bulletinDaysOff);
      const via = this.viaOf(query, settings.bookCurrency, settings.parallelCurrency);
      const legs: [CurrencyCode, CurrencyCode][] = [[query.from, query.to]];
      if (via !== null) legs.push([query.from, via], [via, query.to]);
      const newest = new Map<ExchangeRate, RateRow>();
      for (const [a, b] of legs) {
        // Only the newest row of a pair can be in force: the head of its date's correction chain.
        const [row] = await readRateRows(
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
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const { id, supersededId } = await recordRate(tx, companyId, actorOf(access), input);
      const [recorded] = await readRateRows(tx, [eq(exchangeRates.id, id)], 'recorded', 1);
      const superseded = supersededId
        ? (await readRateRows(tx, [eq(exchangeRates.id, supersededId)], 'recorded', 1))[0]
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
      await setBulletinDaysOff(tx, companyId, actorOf(access), daysOff);
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
      const row = await addBulletinHoliday(tx, companyId, actorOf(access), input);
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

  /** The other ledger currency to cross through (ADR 0007), when `to` is a ledger currency. */
  private viaOf(
    query: RateInForceQuery,
    book: string,
    parallel: string | null,
  ): CurrencyCode | null {
    const other = query.to === book ? parallel : query.to === parallel ? book : null;
    return other === null || other === query.from ? null : (other as CurrencyCode);
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
}
