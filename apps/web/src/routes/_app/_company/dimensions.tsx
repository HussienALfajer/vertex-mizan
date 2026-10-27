import { createFileRoute } from '@tanstack/react-router';
import { DimensionsPage } from '../../../features/dimensions/dimensions-page';
import { requirePermission } from '../../../lib/session';

export const Route = createFileRoute('/_app/_company/dimensions')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'dimensions.read'),
  component: DimensionsPage,
});
