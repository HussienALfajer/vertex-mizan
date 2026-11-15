import { createFileRoute } from '@tanstack/react-router';
import { VoucherPage } from '../../../../../features/cash/voucher-page';
import { requirePermission } from '../../../../../lib/session';

/** `cancel=true`: the register's cancel action opens the cancellation on arrival. */
export const Route = createFileRoute('/_app/_company/cash/vouchers/$id')({
  validateSearch: (search: Record<string, unknown>): { cancel?: true | undefined } => ({
    cancel: search.cancel === true || search.cancel === 'true' ? true : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: VoucherPage,
});
