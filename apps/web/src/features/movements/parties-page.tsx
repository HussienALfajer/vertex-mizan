import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  CLIENT_MOVEMENT_KINDS,
  createPartySchema,
  type Me,
  type Party,
  type PartyType,
  partySchema,
  SUPPLIER_MOVEMENT_KINDS,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { ArrowRightIcon, TruckIcon, UsersIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { api } from '../../lib/api';
import { partiesQuery, projectsQuery, refreshBooks, useBookCurrency } from '../../lib/movements';
import { can } from '../../lib/session';
import { ByCurrency } from './figures';
import { MovementBrowser } from './movement-list';

const t = ar.movements.parties;

/** Where a party's list and page live. */
const listPath = { client: '/clients', supplier: '/suppliers' } as const;
const pagePath = { client: '/clients/$partyId', supplier: '/suppliers/$partyId' } as const;

/** What a party owes the company (a client) or is owed (a supplier), by currency. */
const owedOf = (party: Party) => (party.type === 'client' ? party.owedToUs : party.owedByUs);

/**
 * `/clients` and `/suppliers` (S13 screen 6): each party with its projects and what it owes or is
 * owed, by currency with its USD value; a search by name; a new party by its name.
 */
export function PartiesPage({
  me,
  companyId,
  type,
}: {
  me: Me;
  companyId: string;
  type: PartyType;
}) {
  const labels = t[type];
  const parties = useQuery(partiesQuery(companyId, type));
  const book = useBookCurrency(companyId);
  const [search, setSearch] = useState('');
  const typed = useDeferredValue(search.trim());
  const [adding, setAdding] = useState(false);
  const canAdd = can(me, 'dimensions.manage');
  const shown = (parties.data ?? []).filter((party) => typed === '' || party.name.includes(typed));

  return (
    <>
      <PageHeader
        title={labels.title}
        description={labels.description}
        actions={canAdd && <Button onClick={() => setAdding(true)}>{labels.add}</Button>}
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-[minmax(0,20rem)] [&>*]:min-w-0">
        <Field>
          <FieldLabel>{t.search}</FieldLabel>
          <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </Field>
      </div>
      {parties.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-row w-full" />
          <Skeleton className="h-row w-full" />
          <Skeleton className="h-row w-full" />
        </div>
      ) : parties.isError ? (
        <EmptyState
          title={ar.common.errorTitle}
          description={ar.common.errorDescription}
          action={
            <Button variant="outline" onClick={() => void parties.refetch()}>
              {ar.common.retry}
            </Button>
          }
        />
      ) : shown.length === 0 ? (
        typed !== '' ? (
          <EmptyState title={t.noMatch} />
        ) : (
          <EmptyState
            icon={type === 'client' ? <UsersIcon /> : <TruckIcon />}
            title={labels.empty}
            description={labels.emptyHint}
            action={canAdd && <Button onClick={() => setAdding(true)}>{labels.add}</Button>}
          />
        )
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.columns.name}</TableHead>
              <TableHead numeric>{t.columns.projects}</TableHead>
              <TableHead>{labels.owed}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((party) => (
              <TableRow key={party.id}>
                <TableCell>
                  <Link
                    to={pagePath[type]}
                    params={{ partyId: party.id }}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {party.name}
                  </Link>
                </TableCell>
                <TableCell numeric>{party.projectCount}</TableCell>
                <TableCell className="min-w-48">
                  <ByCurrency
                    amounts={owedOf(party)}
                    bookCurrency={book}
                    empty={labels.owedEmpty}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <NewPartyDialog companyId={companyId} type={type} open={adding} onOpenChange={setAdding} />
    </>
  );
}

/**
 * `/clients/:partyId` and `/suppliers/:partyId` (S13 screen 6): what the party owes or is owed by
 * currency, a client's projects, and the movements naming the party across projects.
 */
export function PartyPage({
  me,
  companyId,
  type,
  partyId,
}: {
  me: Me;
  companyId: string;
  type: PartyType;
  partyId: string;
}) {
  const labels = t[type];
  const parties = useQuery(partiesQuery(companyId, type));
  const book = useBookCurrency(companyId);
  const back = (
    <Button variant="link" size="sm" className="w-fit px-0" render={<Link to={listPath[type]} />}>
      <ArrowRightIcon className="rtl:rotate-0 ltr:rotate-180" />
      {labels.title}
    </Button>
  );

  if (parties.isPending) {
    return (
      <>
        <PageHeader back={back} title={<Skeleton className="h-8 w-48" />} />
        <Skeleton className="h-24 w-full" />
      </>
    );
  }
  if (parties.isError) {
    return (
      <>
        <PageHeader back={back} title={ar.common.errorTitle} />
        <EmptyState
          title={ar.common.errorTitle}
          description={ar.common.errorDescription}
          action={
            <Button variant="outline" onClick={() => void parties.refetch()}>
              {ar.common.retry}
            </Button>
          }
        />
      </>
    );
  }
  const party = parties.data.find((row) => row.id === partyId);
  if (party === undefined) {
    return (
      <>
        <PageHeader back={back} title={labels.notFound} />
        <EmptyState title={labels.notFound} description={t.notFoundHint} />
      </>
    );
  }

  return (
    <>
      <PageHeader back={back} title={party.name} />
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
          <Card className="gap-2 p-4">
            <p className="text-control text-muted-foreground">{labels.owed}</p>
            <ByCurrency amounts={owedOf(party)} bookCurrency={book} empty={labels.owedEmpty} />
          </Card>
          {type === 'client' && can(me, 'reports.read') && (
            <ClientProjects companyId={companyId} clientId={party.id} />
          )}
        </div>
        <section className="flex flex-col gap-3" aria-labelledby="party-movements">
          <h2 id="party-movements" className="font-bold text-lg">
            {t.movements}
          </h2>
          <MovementBrowser
            companyId={companyId}
            scope={{ party: party.id }}
            bookCurrency={book}
            canCancel={can(me, 'entries.post')}
            kinds={type === 'client' ? CLIENT_MOVEMENT_KINDS : SUPPLIER_MOVEMENT_KINDS}
            emptyHint={labels.movementsHint}
          />
        </section>
      </div>
    </>
  );
}

/** A client's projects (the projects list is small: tens, S13 "Volume"). */
function ClientProjects({ companyId, clientId }: { companyId: string; clientId: string }) {
  const projects = useQuery(projectsQuery(companyId));
  const own = (projects.data ?? []).filter((project) => project.client.id === clientId);
  return (
    <Card className="gap-2 p-4">
      <p className="text-control text-muted-foreground">{t.projects}</p>
      {projects.isPending ? (
        <Skeleton className="h-row w-full" />
      ) : projects.isError ? (
        <FormError error={projects.error} />
      ) : own.length === 0 ? (
        <p className="text-control text-muted-foreground">{t.projectsEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {own.map((project) => (
            <li key={project.id} className="flex flex-wrap items-center gap-2">
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                className="font-medium underline-offset-4 hover:underline"
              >
                {project.name}
              </Link>
              <Badge tone={project.state === 'active' ? 'success' : 'neutral'}>
                {ar.movements.states[project.state]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** A new client or supplier by its name (`POST /api/parties`). */
function NewPartyDialog({
  companyId,
  type,
  open,
  onOpenChange,
}: {
  companyId: string;
  type: PartyType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={ar.common.close}>
        <DialogHeader>
          <DialogTitle>{t[type].add}</DialogTitle>
          <DialogDescription>{t[type].addDescription}</DialogDescription>
        </DialogHeader>
        {open && (
          <NewPartyForm companyId={companyId} type={type} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewPartyForm({
  companyId,
  type,
  onDone,
}: {
  companyId: string;
  type: PartyType;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const save = useMutation({
    mutationFn: (body: unknown) =>
      api('POST', '/parties', { company: companyId, body, schema: partySchema }),
    onSuccess: async () => {
      await refreshBooks(queryClient, companyId);
      onDone();
    },
  });
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const trimmed = name.trim();
        const found =
          trimmed === '' ? t.nameRequired : trimmed.length > 200 ? t.tooLong : undefined;
        setError(found);
        if (found) {
          setAttempt((count) => count + 1);
          return;
        }
        save.mutate(createPartySchema.parse({ type, name: trimmed }));
      }}
    >
      <FormErrorSummary attempt={attempt} errors={[['party-name', error]]} />
      <Field id="party-name" invalid={error !== undefined}>
        <FieldLabel>{t.name}</FieldLabel>
        <Input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
        <FieldError match={error !== undefined}>{error}</FieldError>
      </Field>
      <FormError error={save.error} />
      <DialogFooter>
        <Button type="submit" loading={save.isPending}>
          {t.submit}
        </Button>
      </DialogFooter>
    </form>
  );
}
