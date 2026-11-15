import { createFileRoute } from '@tanstack/react-router';
import { VoucherPage } from '../../../../../features/cash/voucher-page';
import { requirePermission } from '../../../../../lib/session';

export const Route = createFileRoute('/_app/_company/cash/vouchers/$id')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: VoucherPage,
});
