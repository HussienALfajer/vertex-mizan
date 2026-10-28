import { createFileRoute } from '@tanstack/react-router';
import { AccountLinesPage } from '../../../../../features/entries/account-lines-page';
import { requirePermission } from '../../../../../lib/session';

export const Route = createFileRoute('/_app/_company/accounts/$id/lines')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'entries.read'),
  component: AccountLinesPage,
});
