import { createFileRoute } from '@tanstack/react-router';
import { AuditPage } from '../../../../features/audit/audit-page';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/settings/audit')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'audit.read'),
  component: AuditPage,
});
