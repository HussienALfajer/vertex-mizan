import { createFileRoute } from '@tanstack/react-router';
import { ExportPage } from '../../../../features/exports/export-page';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/settings/export')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'company.export'),
  component: ExportPage,
});
