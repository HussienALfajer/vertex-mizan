import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Me, ProjectState } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  Badge,
  Button,
  EmptyState,
  Field,
  FieldLabel,
  Input,
  PageHeader,
  SelectField,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { FolderKanbanIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { formatDay } from '../../lib/format';
import { projectsQuery } from '../../lib/movements';
import { can } from '../../lib/session';
import { NewProjectDialog } from './new-project-dialog';

const t = ar.movements.projects;

/**
 * `/projects` (S13 screen 3): each project with its client, movements, net cash and profit in USD;
 * a search by name and the state; a new project in a dialog.
 */
export function ProjectsPage({ me, companyId }: { me: Me; companyId: string }) {
  const [search, setSearch] = useState('');
  const [state, setState] = useState<ProjectState | 'all'>('all');
  const [creating, setCreating] = useState(false);
  const typed = useDeferredValue(search.trim());
  const projects = useQuery(
    projectsQuery(companyId, {
      state: state === 'all' ? undefined : state,
      search: typed === '' ? undefined : typed.slice(0, 100),
    }),
  );
  const filtered = typed !== '' || state !== 'all';
  const canCreate = can(me, 'dimensions.manage');

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={canCreate && <Button onClick={() => setCreating(true)}>{t.newProject}</Button>}
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-[minmax(0,20rem)_minmax(0,12rem)] [&>*]:min-w-0">
        <Field>
          <FieldLabel>{t.search}</FieldLabel>
          <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </Field>
        <SelectField
          label={t.state}
          value={state}
          options={[
            { value: 'all' as const, label: t.all },
            { value: 'active' as const, label: ar.movements.states.active },
            { value: 'finished' as const, label: ar.movements.states.finished },
          ]}
          onValueChange={setState}
        />
      </div>
      {projects.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-row w-full" />
          <Skeleton className="h-row w-full" />
          <Skeleton className="h-row w-full" />
        </div>
      ) : projects.isError ? (
        <EmptyState
          title={ar.common.errorTitle}
          description={ar.common.errorDescription}
          action={
            <Button variant="outline" onClick={() => void projects.refetch()}>
              {ar.common.retry}
            </Button>
          }
        />
      ) : projects.data.length === 0 ? (
        filtered ? (
          <EmptyState title={t.noMatch} />
        ) : (
          <EmptyState
            icon={<FolderKanbanIcon />}
            title={t.empty}
            description={t.emptyHint}
            action={canCreate && <Button onClick={() => setCreating(true)}>{t.newProject}</Button>}
          />
        )
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.columns.project}</TableHead>
              <TableHead>{t.columns.client}</TableHead>
              <TableHead>{t.columns.state}</TableHead>
              <TableHead>{t.columns.start}</TableHead>
              <TableHead numeric>{t.columns.movements}</TableHead>
              <TableHead numeric>{t.columns.netCash}</TableHead>
              <TableHead numeric>{t.columns.profit}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.data.map((project) => (
              <TableRow key={project.id}>
                <TableCell>
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {project.name}
                  </Link>
                </TableCell>
                <TableCell>{project.client.name}</TableCell>
                <TableCell>
                  <Badge tone={project.state === 'active' ? 'success' : 'neutral'}>
                    {ar.movements.states[project.state]}
                  </Badge>
                </TableCell>
                <TableCell>{formatDay(project.startDate)}</TableCell>
                <TableCell numeric>{project.figures.movementCount}</TableCell>
                <TableCell numeric>
                  <Amount
                    value={BigInt(project.figures.netCashMinor)}
                    currency={project.figures.bookCurrency}
                  />
                </TableCell>
                <TableCell numeric>
                  <Amount
                    value={BigInt(project.figures.profitMinor)}
                    currency={project.figures.bookCurrency}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <NewProjectDialog companyId={companyId} open={creating} onOpenChange={setCreating} />
    </>
  );
}
