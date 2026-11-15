import { createFileRoute } from '@tanstack/react-router';
import {
  VOUCHER_KINDS,
  VOUCHER_STATES,
  type VoucherKind,
  type VoucherState,
} from '@vertex-mizan/contracts';
import { VouchersPage } from '../../../../../features/cash/vouchers-page';
import { requirePermission } from '../../../../../lib/session';

const day = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;

/** The register's filters in the address: kind, cash account, state and a range of dates. */
export const Route = createFileRoute('/_app/_company/cash/vouchers/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    kind?: VoucherKind | undefined;
    account?: string | undefined;
    state?: VoucherState | undefined;
    from?: string | undefined;
    to?: string | undefined;
  } => ({
    kind: VOUCHER_KINDS.includes(search.kind as VoucherKind)
      ? (search.kind as VoucherKind)
      : undefined,
    account: typeof search.account === 'string' ? search.account : undefined,
    state: VOUCHER_STATES.includes(search.state as VoucherState)
      ? (search.state as VoucherState)
      : undefined,
    from: day(search.from),
    to: day(search.to),
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: VouchersPage,
});
