import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { MyMembership } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { BuildingIcon, PlusIcon } from 'lucide-react';
import { FormError } from '../../components/form-error';
import { meQuery } from '../../lib/session';
import { useSwitchCompany } from './company-queries';

const t = ar.company.list;

/** `/companies` (S01 rule 19): the person's companies; opening one makes it the active company. */
export function CompaniesPage() {
  const me = useQuery(meQuery);
  const open = useSwitchCompany();
  const create = (
    <Button render={<Link to="/companies/new" />}>
      <PlusIcon aria-hidden="true" />
      {t.create}
    </Button>
  );

  return (
    <>
      <PageHeader title={t.title} description={t.description} actions={create} />
      <FormError error={open.error} />
      {me.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
        </div>
      ) : me.isError ? (
        <FormError error={me.error} />
      ) : !me.data || me.data.memberships.length === 0 ? (
        <EmptyState
          icon={<BuildingIcon />}
          title={t.emptyTitle}
          description={t.emptyDescription}
          action={create}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{ar.company.fields.name}</TableHead>
              <TableHead>{t.role}</TableHead>
              <TableHead>
                <span className="sr-only">{t.open}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {me.data.memberships.map((membership) => (
              <CompanyRow
                key={membership.membershipId}
                membership={membership}
                active={membership.company.id === me.data?.activeCompanyId}
                opening={open.isPending && open.variables === membership.company.id}
                onOpen={() => open.mutate(membership.company.id)}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

function CompanyRow({
  membership,
  active,
  opening,
  onOpen,
}: {
  membership: MyMembership;
  active: boolean;
  opening: boolean;
  onOpen: () => void;
}) {
  const { company } = membership;
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          <bdi className="font-medium">{company.name}</bdi>
          {company.nameLatin && (
            <bdi className="text-muted-foreground" dir="ltr">
              {company.nameLatin}
            </bdi>
          )}
          {active && <Badge tone="brand">{t.active}</Badge>}
          {company.archived && <Badge tone="warning">{t.archived}</Badge>}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap">{ar.roles[membership.role]}</TableCell>
      <TableCell className="text-end">
        <Button
          variant="outline"
          size="sm"
          loading={opening}
          onClick={onOpen}
          aria-label={`${t.open} ${company.name}`}
        >
          {t.open}
        </Button>
      </TableCell>
    </TableRow>
  );
}
