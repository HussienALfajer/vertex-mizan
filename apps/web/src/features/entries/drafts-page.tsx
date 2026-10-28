import { useInfiniteQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { DRAFT_VIEWS, type DraftSummary } from '@vertex-mizan/contracts';
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@vertex-mizan/ui';
import { FilePenLineIcon, PlusIcon } from 'lucide-react';
import { FormError } from '../../components/form-error';
import { formatDateTime, formatDay } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { draftsQuery } from './entry-queries';

const t = ar.drafts;
const route = getRouteApi('/_app/_company/drafts/');

type View = (typeof DRAFT_VIEWS)[number];

/**
 * `/drafts` (S03 "Screens"): the person's drafts, every open draft, and the approval queue. A
 * draft opens on the entry screen, where approvers approve or reject it.
 */
export function DraftsPage() {
  const { me, membership } = useCompany();
  const view = route.useSearch().view ?? 'all';
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          can(me, 'drafts.manage') && !membership.company.archived ? (
            <Button render={<Link to="/entries/new" />}>
              <PlusIcon aria-hidden="true" />
              {ar.entries.newEntry}
            </Button>
          ) : undefined
        }
      />
      <Tabs
        value={view}
        onValueChange={(next) =>
          void navigate({ to: '/drafts', search: { view: next as View }, replace: true })
        }
      >
        <TabsList aria-label={t.views.label}>
          {DRAFT_VIEWS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t.views[value]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={view}>
          <DraftList key={view} view={view} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function DraftState({ draft }: { draft: DraftSummary }) {
  return (
    <span className="flex flex-wrap gap-1">
      <Badge tone={draft.state === 'submitted' ? 'warning' : 'neutral'}>
        {t.states[draft.state]}
      </Badge>
      {draft.rejected && <Badge tone="danger">{t.rejected}</Badge>}
      {draft.reversesEntryId && <Badge tone="info">{t.reversal}</Badge>}
    </span>
  );
}

function DraftList({ view }: { view: View }) {
  const { companyId } = useCompany();
  const list = useInfiniteQuery(draftsQuery(companyId, view));
  const rows = list.data?.pages.flatMap((page) => page.drafts) ?? [];
  if (list.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-row" />
        <Skeleton className="h-row" />
      </div>
    );
  }
  if (list.isError) return <FormError error={list.error} />;
  if (rows.length === 0) return <EmptyState icon={<FilePenLineIcon />} title={t.empty[view]} />;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Table aria-label={`${t.table.label}: ${t.views[view]}`}>
        <TableHeader>
          <TableRow>
            <TableHead>{t.table.date}</TableHead>
            <TableHead>{t.table.description}</TableHead>
            <TableHead numeric className="max-sm:hidden">
              {t.table.lines}
            </TableHead>
            <TableHead className="max-md:hidden">{t.table.preparedBy}</TableHead>
            <TableHead>{t.table.state}</TableHead>
            <TableHead className="max-lg:hidden">{t.table.updatedAt}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((draft) => (
            <TableRow key={draft.id}>
              <TableCell className="whitespace-nowrap">{formatDay(draft.entryDate)}</TableCell>
              <TableCell className="max-w-72 truncate">
                <Link
                  to="/drafts/$id"
                  params={{ id: draft.id }}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {draft.description ? <bdi>{draft.description}</bdi> : t.table.untitled}
                </Link>
              </TableCell>
              <TableCell numeric className="max-sm:hidden">
                <bdi dir="ltr">{draft.lineCount}</bdi>
              </TableCell>
              <TableCell className="max-md:hidden">
                <bdi>{draft.preparedBy.name}</bdi>
              </TableCell>
              <TableCell>
                <DraftState draft={draft} />
              </TableCell>
              <TableCell className="max-lg:hidden whitespace-nowrap">
                {formatDateTime(draft.updatedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {list.hasNextPage && (
        <Button
          variant="outline"
          className="w-fit self-center"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {ar.entries.loadMore}
        </Button>
      )}
    </div>
  );
}
