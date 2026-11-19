import { createFileRoute } from '@tanstack/react-router';
import { ProjectsPage } from '../../../features/movements/projects-page';

/** `/projects` (S13 screen 3). */
export const Route = createFileRoute('/_app/projects/')({
  component: function Projects() {
    const { me, companyId } = Route.useRouteContext();
    return <ProjectsPage me={me} companyId={companyId} />;
  },
});
