import { createFileRoute } from '@tanstack/react-router';
import { IntegrityPage } from '../../../features/integrity/integrity-page';
import { requirePermission } from '../../../lib/session';

/** `run`: run the check on arrival, from the palette's "run integrity check". */
export const Route = createFileRoute('/_app/_company/integrity')({
  validateSearch: (search: Record<string, unknown>): { run?: true | undefined } => ({
    run: search.run === true || search.run === 'true' ? true : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'integrity.read'),
  component: IntegrityPage,
});
