import { Inject, Injectable } from '@nestjs/common';
import type {
  CashPosition,
  CashPositionQuery,
  CashStatement,
  CashStatementQuery,
  Voucher,
  VoucherPage,
  VoucherQuery,
  VoucherSummary,
} from '@vertex-mizan/contracts';
import {
  type Database,
  readCashPosition,
  readCashStatement,
  readVoucherRows,
  type Transaction,
  type VoucherRow,
  withCompany,
} from '@vertex-mizan/db';
import type { CompanyRouteAccess } from '../../core/access/access.js';
import { todayInDamascus } from '../../core/clock/today.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { decodeCursor, encodeCursor } from '../../core/http/cursor.js';
import { peopleOf, readEntry } from '../entries/entry-shape.js';

const PAGE_SIZE = 100;

const summaryOf = (row: VoucherRow): VoucherSummary => ({
  id: row.id,
  kind: row.kind,
  fiscalYear: row.fiscalYear,
  number: row.number,
  date: row.date,
  state: row.state,
  cashAccount: row.cashAccount,
  counterCashAccount: row.counterCashAccount,
  amount: { amountMinor: row.amountMinor, currency: row.cashAccount.currency },
  partyName: row.partyName,
  description: row.description,
  entry: row.entry,
  reversal: row.reversal,
  expectedMinor: row.expectedMinor,
  countedMinor: row.countedMinor,
});

/**
 * The cash screens' reads (S11 "API"): the cash position, a cash account's statement, the
 * vouchers' register and a voucher with its entry, through `packages/db`'s cash reads in one
 * repeatable-read snapshot. Reads with `reports.read`, every role's; not audited (S01 rule 24).
 */
@Injectable()
export class CashService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  #read<T>(access: CompanyRouteAccess, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return withCompany(this.db, access.company.id, work, { isolationLevel: 'repeatable read' });
  }

  /** `GET /api/cash/accounts` (rule 16): at the end of `asOf`, today in Damascus by default. */
  position(access: CompanyRouteAccess, query: CashPositionQuery): Promise<CashPosition> {
    return this.#read(access, (tx) => readCashPosition(tx, query.asOf ?? todayInDamascus()));
  }

  /** `GET /api/cash/accounts/:id/statement` (rule 17); another company's account is `NOT_FOUND`. */
  statement(
    access: CompanyRouteAccess,
    id: string,
    query: CashStatementQuery,
  ): Promise<CashStatement> {
    return this.#read(access, (tx) => readCashStatement(tx, id, query));
  }

  /** `GET /api/vouchers`: by voucher date, newest first, pages of 100. */
  list(access: CompanyRouteAccess, query: VoucherQuery): Promise<VoucherPage> {
    return this.#read(access, async (tx) => {
      const { cursor, ...filters } = query;
      const rows = await readVoucherRows(
        tx,
        { ...filters, ...(cursor !== undefined && { after: decodeCursor(cursor).id }) },
        PAGE_SIZE,
      );
      const page = rows.slice(0, PAGE_SIZE);
      const last = page.at(-1);
      return {
        vouchers: page.map(summaryOf),
        nextCursor:
          rows.length > PAGE_SIZE && last
            ? encodeCursor({ id: last.id, createdAt: new Date(last.createdAt) })
            : null,
      };
    });
  }

  /** `GET /api/vouchers/:id`: the voucher with its entry, its preparer and its approver. */
  get(access: CompanyRouteAccess, id: string): Promise<Voucher> {
    return this.#read(access, async (tx) => {
      const [row] = await readVoucherRows(tx, { id }, 1);
      if (row === undefined) throw new CodedException('NOT_FOUND', 'No such voucher');
      const people = await peopleOf(tx, [row.preparedByUserId, row.approvedByUserId]);
      return {
        ...summaryOf(row),
        draftId: row.draftId,
        preparedBy:
          row.preparedByUserId === null ? null : (people.get(row.preparedByUserId) ?? null),
        approvedBy:
          row.approvedByUserId === null ? null : (people.get(row.approvedByUserId) ?? null),
        entryDetail: row.entry === null ? null : await readEntry(tx, row.entry.id),
        createdAt: row.createdAt,
      };
    });
  }
}
