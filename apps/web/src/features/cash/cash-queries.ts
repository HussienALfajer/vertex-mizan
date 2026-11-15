import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import {
  cashPositionSchema,
  cashStatementSchema,
  type VoucherQuery,
  voucherPageSchema,
  voucherSchema,
} from '@vertex-mizan/contracts';
import { api } from '../../lib/api';
import { searchOf } from '../receivables/receivables-queries';

/** `GET /api/cash/accounts`: the cash position at the end of a date (S11 rule 16). */
export function cashPositionQuery(companyId: string, asOf: string | undefined) {
  return queryOptions({
    queryKey: ['cash', companyId, 'position', asOf ?? null],
    queryFn: () =>
      api('GET', `/cash/accounts${searchOf({ asOf })}`, {
        company: companyId,
        schema: cashPositionSchema,
      }),
  });
}

export interface CashStatementParams {
  readonly from: string;
  readonly to: string;
  /** `book`, `parallel`, both joined by a comma, or none. */
  readonly ledgers: string | undefined;
}

/** `GET /api/cash/accounts/:id/statement` (S11 rule 17). */
export function cashStatementQuery(companyId: string, id: string, params: CashStatementParams) {
  return queryOptions({
    queryKey: ['cash', companyId, 'statement', id, params],
    queryFn: () =>
      api('GET', `/cash/accounts/${id}/statement${searchOf({ ...params })}`, {
        company: companyId,
        schema: cashStatementSchema,
      }),
  });
}

/** `GET /api/vouchers`: the register, newest first, a page of 100 at a time. */
export function vouchersQuery(companyId: string, filters: Omit<VoucherQuery, 'cursor'>) {
  return infiniteQueryOptions({
    queryKey: ['cash', companyId, 'vouchers', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api('GET', `/vouchers${searchOf({ ...filters, cursor: pageParam })}`, {
        company: companyId,
        schema: voucherPageSchema,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** `GET /api/vouchers/:id`: the voucher with its entry. */
export function voucherQuery(companyId: string, id: string) {
  return queryOptions({
    queryKey: ['cash', companyId, 'voucher', id],
    queryFn: () => api('GET', `/vouchers/${id}`, { company: companyId, schema: voucherSchema }),
  });
}
