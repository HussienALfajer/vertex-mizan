import { createFileRoute } from '@tanstack/react-router';
import { MaterialsPage } from '../../../features/projects/materials-page';
import { requirePermission } from '../../../lib/session';

/** The materials catalogue (S12 rule 3): every role with `dimensions.read` reads it. */
export const Route = createFileRoute('/_app/_company/materials')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'dimensions.read'),
  component: MaterialsPage,
});
