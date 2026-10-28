import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CompanyExport, companyExportSchema, type ExportState } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Badge,
  Button,
  Callout,
  Digest,
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
import { DownloadIcon, PackageIcon } from 'lucide-react';
import { FormError } from '../../components/form-error';
import { useSensitiveAction } from '../../components/reauth-dialog';
import { api, download, listOf } from '../../lib/api';
import { formatDateTime, formatKilobytes } from '../../lib/format';
import { useCompany } from '../../lib/session';

const t = ar.export;

/** How often the list is read again while an export is being built (the worker runs each minute). */
const queuedRefresh = 10_000;

/** `GET /api/company/exports`: the newest first. */
export function exportsQuery(companyId: string) {
  return queryOptions({
    queryKey: ['exports', companyId],
    queryFn: () =>
      api('GET', '/company/exports', { company: companyId, schema: listOf(companyExportSchema) }),
    refetchInterval: (query) =>
      query.state.data?.some((row) => row.state === 'queued') ? queuedRefresh : false,
  });
}

const stateTone: Record<ExportState, 'info' | 'success' | 'danger' | 'neutral'> = {
  queued: 'info',
  ready: 'success',
  failed: 'danger',
  expired: 'neutral',
};

/**
 * `/settings/export` (S03 rule 21, "Screens"): the owner requests a full export of the company's
 * data and downloads it while it is ready. Both ask for a fresh authenticator code.
 */
export function ExportPage() {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const exports = useQuery(exportsQuery(companyId));
  const { run, dialog } = useSensitiveAction();
  const request = useMutation({
    mutationFn: () =>
      run(() =>
        api('POST', '/company/exports', { company: companyId, schema: companyExportSchema }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['exports', companyId] }),
  });
  const fetchFile = useMutation({
    mutationFn: (row: CompanyExport) =>
      run(() => download(`/company/exports/${row.id}/download`, { company: companyId })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['exports', companyId] }),
  });
  const queued = exports.data?.some((row) => row.state === 'queued') ?? false;
  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          <Button loading={request.isPending} disabled={queued} onClick={() => request.mutate()}>
            <PackageIcon aria-hidden="true" />
            {t.request}
          </Button>
        }
      />
      <div className="flex min-w-0 flex-col gap-4">
        {request.isSuccess && <Callout role="status" tone="info" title={t.requested} />}
        {queued && !request.isSuccess && <Callout tone="info" title={t.inProgress} />}
        <FormError error={request.error} />
        <FormError error={fetchFile.error} />
        {exports.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-row" />
            <Skeleton className="h-row" />
          </div>
        ) : exports.isError ? (
          <FormError error={exports.error} />
        ) : exports.data.length === 0 ? (
          <EmptyState
            icon={<PackageIcon />}
            title={t.empty.title}
            description={t.empty.description}
          />
        ) : (
          <Table aria-label={t.table.label}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.table.requestedAt}</TableHead>
                <TableHead className="max-md:hidden">{t.table.requestedBy}</TableHead>
                <TableHead>{t.table.state}</TableHead>
                <TableHead numeric className="max-sm:hidden">
                  {t.table.size}
                </TableHead>
                <TableHead className="max-lg:hidden">{t.table.sha256}</TableHead>
                <TableHead className="max-sm:hidden">{t.table.expiresAt}</TableHead>
                <TableHead>
                  <span className="sr-only">{t.table.actions}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exports.data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell className="max-md:hidden">
                    <bdi>{row.requestedBy.name}</bdi>
                  </TableCell>
                  <TableCell>
                    <Badge tone={stateTone[row.state]}>{t.states[row.state]}</Badge>
                  </TableCell>
                  <TableCell numeric className="max-sm:hidden">
                    {row.sizeBytes === null ? null : (
                      <bdi dir="ltr">{formatKilobytes(row.sizeBytes)}</bdi>
                    )}
                  </TableCell>
                  <TableCell className="max-lg:hidden">
                    {row.sha256 && (
                      <Digest value={row.sha256} copyLabel={t.copyHash} copiedLabel={t.copied} />
                    )}
                  </TableCell>
                  <TableCell className="max-sm:hidden whitespace-nowrap">
                    {row.state === 'ready' && row.expiresAt ? formatDateTime(row.expiresAt) : null}
                  </TableCell>
                  <TableCell>
                    {row.state === 'ready' && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={fetchFile.isPending && fetchFile.variables?.id === row.id}
                        onClick={() => fetchFile.mutate(row)}
                      >
                        <DownloadIcon aria-hidden="true" />
                        {t.download}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {exports.data?.some((row) => row.state === 'failed') && (
          <p className="text-sm text-muted-foreground">{t.failedHint}</p>
        )}
      </div>
      {dialog}
    </>
  );
}
