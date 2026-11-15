import { createFileRoute, notFound } from '@tanstack/react-router';
import { VOUCHER_KINDS, type VoucherKind } from '@vertex-mizan/contracts';
import { NewVoucherPage } from '../../../../../../features/entries/entry-editor-page';
import { requirePermission } from '../../../../../../lib/session';

/** `account`: the cash account a card's action starts the voucher on. */
export const Route = createFileRoute('/_app/_company/cash/vouchers/new/$kind')({
  params: {
    parse: (params) => {
      if (!VOUCHER_KINDS.includes(params.kind as VoucherKind)) throw notFound();
      return { kind: params.kind as VoucherKind };
    },
    stringify: (params) => params,
  },
  validateSearch: (search: Record<string, unknown>): { account?: string | undefined } => ({
    account: typeof search.account === 'string' ? search.account : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'drafts.manage'),
  component: NewVoucherPage,
});
