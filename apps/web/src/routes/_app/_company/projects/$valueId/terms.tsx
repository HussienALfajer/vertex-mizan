import { createFileRoute } from '@tanstack/react-router';
import { ProjectTermsPage } from '../../../../../features/projects/project-terms-page';
import { requirePermission } from '../../../../../lib/session';

/** A project's terms, budget and subcontracts (S12 rules 1–2). */
export const Route = createFileRoute('/_app/_company/projects/$valueId/terms')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'dimensions.read'),
  component: ProjectTermsPage,
});
