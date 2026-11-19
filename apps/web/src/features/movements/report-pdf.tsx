import { useMutation, useQuery } from '@tanstack/react-query';
import {
  type ActiveReport,
  type ErrorCode,
  type ReportFile,
  reportFileSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { Button, ExportFileState } from '@vertex-mizan/ui';
import { FileTextIcon } from 'lucide-react';
import { useState } from 'react';
import { api, download, errorText } from '../../lib/api';

/** A failed file's reason: its error code's text, or the generic one. */
const failureText = (code: string) =>
  Object.hasOwn(ar.errors, code) ? ar.errors[code as ErrorCode] : ar.movements.print.failed;

/** How often a queued file is read again until the worker has printed it. */
const POLL_MS = 1500;

/**
 * One of S13's PDFs (S13 "Printing"): asked of `POST /api/reports/files`, its state read until the
 * worker prints it, then downloaded. The state is announced politely beside the button
 * (`ExportFileState`); a refusal names its reason.
 */
export function ReportPdfButton({
  companyId,
  report,
  params,
  label,
}: {
  companyId: string;
  report: Extract<ActiveReport, 'projects_overview' | 'project_statement' | 'material_costs'>;
  params: Record<string, string>;
  label: string;
}) {
  const [fileId, setFileId] = useState<string | null>(null);
  const ask = useMutation({
    mutationFn: () =>
      api('POST', '/reports/files', {
        company: companyId,
        body: { report, params },
        schema: reportFileSchema,
      }),
    onSuccess: (file) => setFileId(file.id),
  });
  const file = useQuery({
    queryKey: ['movements', companyId, 'report-file', fileId],
    queryFn: () =>
      api('GET', `/reports/files/${fileId}`, { company: companyId, schema: reportFileSchema }),
    enabled: fileId !== null,
    refetchInterval: (query) =>
      (query.state.data as ReportFile | undefined)?.state === 'queued' ? POLL_MS : false,
  });
  const save = useMutation({
    mutationFn: () => download(`/reports/files/${fileId}/download`, { company: companyId }),
  });
  const refusal = ask.error ?? file.error ?? save.error;
  const state = refusal
    ? { state: 'failed' as const, error: errorText(refusal) }
    : fileId === null
      ? null
      : file.data === undefined
        ? { state: 'queued' as const }
        : {
            state: file.data.state,
            ...(file.data.error === null ? {} : { error: failureText(file.data.error) }),
          };
  return (
    <div data-slot="report-pdf" className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        loading={ask.isPending}
        disabled={state?.state === 'queued'}
        onClick={() => {
          save.reset();
          setFileId(null);
          ask.mutate();
        }}
      >
        <FileTextIcon aria-hidden="true" />
        {label}
      </Button>
      <ExportFileState
        labels={ar.reports.exportMenu}
        file={state}
        onDownload={() => save.mutate()}
        downloading={save.isPending}
      />
    </div>
  );
}
