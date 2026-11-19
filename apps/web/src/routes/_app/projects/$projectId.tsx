import { createFileRoute } from '@tanstack/react-router';
import { ProjectPage } from '../../../features/movements/project-page';

/** `/projects/:projectId` (S13 screen 4). */
export const Route = createFileRoute('/_app/projects/$projectId')({
  component: function Project() {
    const { me, companyId } = Route.useRouteContext();
    const { projectId } = Route.useParams();
    return <ProjectPage key={projectId} me={me} companyId={companyId} projectId={projectId} />;
  },
});
