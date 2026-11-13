import { createFileRoute } from '@tanstack/react-router';
import { OpeningPage } from '../../../features/opening/opening-page';
import { requirePermission } from '../../../lib/session';

export const Route = createFileRoute('/_app/_company/opening')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'opening.read'),
  component: OpeningPage,
});
