import { createFileRoute, notFound } from '@tanstack/react-router';
import { PROJECT_DOCUMENT_KINDS, type ProjectDocumentKind } from '@vertex-mizan/contracts';
import { NewProjectDocumentPage } from '../../../../../../features/entries/entry-editor-page';
import { requirePermission } from '../../../../../../lib/session';

/** `project`: the project a project's page starts the document on. */
export const Route = createFileRoute('/_app/_company/projects/documents/new/$kind')({
  params: {
    parse: (params) => {
      if (!PROJECT_DOCUMENT_KINDS.includes(params.kind as ProjectDocumentKind)) throw notFound();
      return { kind: params.kind as ProjectDocumentKind };
    },
    stringify: (params) => params,
  },
  validateSearch: (search: Record<string, unknown>): { project?: string | undefined } => ({
    project: typeof search.project === 'string' ? search.project : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'drafts.manage'),
  component: NewProjectDocumentPage,
});
