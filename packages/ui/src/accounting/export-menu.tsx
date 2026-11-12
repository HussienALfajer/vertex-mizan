'use client';

import {
  ChevronDownIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  Loader2Icon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '../components/badge';
import { Button } from '../components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/dropdown-menu';
import { cn } from '../lib/cn';

/** The state of the PDF the menu last asked for (S09 rule 36), as `report_files` keeps it. */
export interface ExportMenuFile {
  readonly state: 'queued' | 'ready' | 'failed' | 'expired';
  /** Why it failed, in words (the error code's text). */
  readonly error?: ReactNode;
}

export interface ExportMenuLabels {
  /** The trigger ("تصدير"). */
  readonly trigger: string;
  readonly excel: string;
  readonly pdf: string;
  /** The PDF's states: "قيد الإعداد", "جاهز", "تعذّر الإعداد", "انتهت صلاحيته". */
  readonly queued: string;
  readonly failed: string;
  readonly expired: string;
  /** The ready PDF's download button ("تنزيل PDF"). */
  readonly download: string;
}

/**
 * A report's exports (S09 "Screens", rules 35–36): a menu with Excel (downloaded at once) and
 * PDF (queued for the worker), then the PDF's state beside it: queued with a spinner, failed with
 * its reason, expired, or a download button once ready. An export without a handler is not
 * offered; the state is announced politely. Labels come in as props.
 */
function ExportMenu({
  labels,
  onExcel,
  onPdf,
  pending = null,
  file = null,
  onDownload,
  downloading = false,
  disabled = false,
  className,
}: {
  labels: ExportMenuLabels;
  onExcel?: (() => void) | undefined;
  onPdf?: (() => void) | undefined;
  /** The export being requested: its menu item waits, the trigger shows it busy. */
  pending?: 'excel' | 'pdf' | null | undefined;
  file?: ExportMenuFile | null | undefined;
  onDownload?: (() => void) | undefined;
  downloading?: boolean | undefined;
  /** Nothing to export yet (the report is loading). */
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <div data-slot="export-menu" className={cn('flex flex-wrap items-center gap-2', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" loading={pending !== null} disabled={disabled} />}
        >
          <DownloadIcon aria-hidden="true" />
          {labels.trigger}
          <ChevronDownIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onExcel && (
            <DropdownMenuItem onClick={onExcel} disabled={pending !== null}>
              <FileSpreadsheetIcon aria-hidden="true" />
              {labels.excel}
            </DropdownMenuItem>
          )}
          {onPdf && (
            <DropdownMenuItem onClick={onPdf} disabled={pending !== null}>
              <FileTextIcon aria-hidden="true" />
              {labels.pdf}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ExportFileState
        labels={labels}
        file={file}
        onDownload={onDownload}
        downloading={downloading}
      />
    </div>
  );
}

/**
 * A queued PDF's state (S09 rule 36), announced politely: queued with a spinner, failed with its
 * reason, expired, or its download once ready. `ExportMenu` shows it beside its menu; a screen that
 * requests a file another way (the journal book's print) shows it alone.
 */
function ExportFileState({
  labels,
  file,
  onDownload,
  downloading = false,
}: {
  labels: ExportMenuLabels;
  file: ExportMenuFile | null | undefined;
  onDownload?: (() => void) | undefined;
  downloading?: boolean | undefined;
}) {
  return (
    <output data-slot="export-menu-state" aria-live="polite" className="flex items-center gap-2">
      {file?.state === 'queued' && (
        <Badge tone="info">
          <Loader2Icon aria-hidden="true" className="animate-spin" />
          {`${labels.pdf}: ${labels.queued}`}
        </Badge>
      )}
      {file?.state === 'failed' && (
        <Badge tone="danger" className="h-auto min-h-6 whitespace-normal">
          {`${labels.pdf}: ${labels.failed}`}
          {file.error ? <span className="font-normal">({file.error})</span> : null}
        </Badge>
      )}
      {file?.state === 'expired' && (
        <Badge tone="neutral">{`${labels.pdf}: ${labels.expired}`}</Badge>
      )}
      {file?.state === 'ready' && onDownload && (
        <Button variant="secondary" loading={downloading} onClick={onDownload}>
          <FileTextIcon aria-hidden="true" />
          {labels.download}
        </Button>
      )}
    </output>
  );
}

export { ExportFileState, ExportMenu };
