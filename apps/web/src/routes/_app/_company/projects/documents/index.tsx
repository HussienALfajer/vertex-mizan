import { createFileRoute } from '@tanstack/react-router';
import {
  PROJECT_DOCUMENT_KINDS,
  PROJECT_DOCUMENT_STATES,
  type ProjectDocumentKind,
} from '@vertex-mizan/contracts';
import { ProjectDocumentsPage } from '../../../../../features/projects/project-documents-page';
import { dateParam, uuidParam } from '../../../../../features/reports/report-search';
import { requirePermission } from '../../../../../lib/session';

type DocumentState = (typeof PROJECT_DOCUMENT_STATES)[number];

/** The register's filters in the address: kind, project, state and a range of dates. */
export const Route = createFileRoute('/_app/_company/projects/documents/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    kind?: ProjectDocumentKind | undefined;
    project?: string | undefined;
    state?: DocumentState | undefined;
    from?: string | undefined;
    to?: string | undefined;
  } => ({
    kind: PROJECT_DOCUMENT_KINDS.includes(search.kind as ProjectDocumentKind)
      ? (search.kind as ProjectDocumentKind)
      : undefined,
    project: uuidParam(search.project),
    state: PROJECT_DOCUMENT_STATES.includes(search.state as DocumentState)
      ? (search.state as DocumentState)
      : undefined,
    from: dateParam(search.from),
    to: dateParam(search.to),
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: ProjectDocumentsPage,
});
