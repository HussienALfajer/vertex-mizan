import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { ar } from '@vertex-mizan/i18n';
import { EmptyState, Skeleton } from '@vertex-mizan/ui';
import { FileQuestionIcon } from 'lucide-react';
import { useState } from 'react';
import { FormError } from '../../components/form-error';
import { hasCode } from '../../lib/api';
import { useCompany } from '../../lib/session';
import { accountsQuery } from '../chart/chart-queries';
import { companyQuery } from '../company/company-queries';
import { ratePairsQuery } from '../rates/rate-queries';
import { EntryEditor } from './entry-editor';
import { BackLink } from './entry-parts';
import { draftQuery } from './entry-queries';

const draftRoute = getRouteApi('/_app/_company/drafts/$id');

function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-16" />
      <Skeleton className="h-40" />
      <Skeleton className="h-64" />
    </div>
  );
}

/**
 * What every entry screen reads first: the company (ledgers, approval), its chart and its rate
 * pairs (a dealt rate's orientation decides what the draft sends, so it is known from the start).
 */
function useEditorBasics() {
  const { companyId } = useCompany();
  const company = useQuery(companyQuery(companyId));
  const accounts = useQuery(accountsQuery(companyId));
  const pairs = useQuery(ratePairsQuery(companyId));
  return { company, accounts, pairs };
}

/** `/entries/new`: a new manual entry, created as a draft by its first save. */
export function NewEntryPage() {
  const { company, accounts, pairs } = useEditorBasics();
  if (company.isPending || accounts.isPending || pairs.isPending) return <Loading />;
  if (company.isError || accounts.isError || pairs.isError) {
    return <FormError error={company.error ?? accounts.error ?? pairs.error} />;
  }
  return (
    <EntryEditor draft={null} company={company.data} accounts={accounts.data} pairs={pairs.data} />
  );
}

/** `/drafts/:id`: a draft on the entry screen; `?open=preview` runs its preview on opening. */
export function DraftEditorPage() {
  const { id } = draftRoute.useParams();
  const { open } = draftRoute.useSearch();
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const { company, accounts, pairs } = useEditorBasics();
  const draft = useQuery({ ...draftQuery(companyId, id), refetchOnWindowFocus: false });
  const [reloads, setReloads] = useState(0);
  if (draft.isPending || company.isPending || accounts.isPending || pairs.isPending) {
    return <Loading />;
  }
  if (draft.isError) {
    return hasCode(draft.error, 'NOT_FOUND') || hasCode(draft.error, 'VALIDATION_FAILED') ? (
      <>
        <BackLink to="/drafts" label={ar.drafts.nav} />
        <EmptyState icon={<FileQuestionIcon />} title={ar.drafts.editor.notFound} />
      </>
    ) : (
      <FormError error={draft.error} />
    );
  }
  if (company.isError || accounts.isError || pairs.isError) {
    return <FormError error={company.error ?? accounts.error ?? pairs.error} />;
  }
  const { data } = draft;
  // A change of state (submitted, withdrawn, rejected, discarded) or a reload starts over from
  // the stored draft; a save of the screen's own edits does not.
  const key = [data.id, data.state, data.rejected?.at, data.archived?.at, reloads].join(':');
  return (
    <EntryEditor
      key={key}
      draft={data}
      company={company.data}
      accounts={accounts.data}
      pairs={pairs.data}
      runPreview={open === 'preview'}
      onReload={async () => {
        await queryClient.refetchQueries({ queryKey: draftQuery(companyId, id).queryKey });
        setReloads((count) => count + 1);
      }}
    />
  );
}
