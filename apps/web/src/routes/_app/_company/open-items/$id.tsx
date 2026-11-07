import { createFileRoute } from '@tanstack/react-router';
import { OpenItemPage } from '../../../../features/receivables/open-item-page';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/open-items/$id')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'open_items.read'),
  component: OpenItemPage,
});
