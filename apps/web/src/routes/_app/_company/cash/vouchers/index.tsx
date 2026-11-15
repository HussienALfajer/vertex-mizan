import { createFileRoute } from '@tanstack/react-router';
import {
  VOUCHER_KINDS,
  VOUCHER_STATES,
  type VoucherKind,
  type VoucherState,
} from '@vertex-mizan/contracts';
import { VouchersPage } from '../../../../../features/cash/vouchers-page';
import { requirePermission } from '../../../../../lib/session';

/** The register's filters in the address. */
export const Route = createFileRoute('/_app/_company/cash/vouchers/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    kind?: VoucherKind | undefined;
    account?: string | undefined;
    state?: VoucherState | undefined;
  } => ({
    kind: VOUCHER_KINDS.includes(search.kind as VoucherKind)
      ? (search.kind as VoucherKind)
      : undefined,
    account: typeof search.account === 'string' ? search.account : undefined,
    state: VOUCHER_STATES.includes(search.state as VoucherState)
      ? (search.state as VoucherState)
      : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: VouchersPage,
});
