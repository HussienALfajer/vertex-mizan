import { createFileRoute } from '@tanstack/react-router';
import { PostingRulesPage } from '../../../../features/posting-rules/posting-rules-page';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/settings/posting-rules')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'posting_rules.read'),
  component: PostingRulesPage,
});
