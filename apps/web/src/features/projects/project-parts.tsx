import { Link } from '@tanstack/react-router';
import type { DimensionValue, ProjectDocumentKind } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { Badge, Button, ExportFileState } from '@vertex-mizan/ui';
import { ArrowRightIcon, PrinterIcon } from 'lucide-react';
import { FormError } from '../../components/form-error';
import { formatEntryNumber } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { useDimensionCatalog } from '../entries/entry-queries';
import { useReportFile } from '../reports/report-parts';

const t = ar.projects;

/** The built-in dimension types a project document names, by their codes (S02, S11). */
export type CounterpartyTypeCode = 'client' | 'supplier' | 'worker';

/**
 * The dimension catalog with the project documents' values: the projects (contract values of kind
 * `project`, S12 rule 1) and the clients, suppliers and workers, active ones first in name order.
 */
export function useProjectCatalog(companyId: string) {
  const catalog = useDimensionCatalog(companyId);
  const typeOf = (code: string) => catalog.types.find((type) => type.code === code);
  const valuesOf = (code: string) => {
    const type = typeOf(code);
    return type ? catalog.valuesOf(type.id) : [];
  };
  return {
    catalog,
    projects: valuesOf('contract').filter((value) => value.contractKind === 'project'),
    counterparties: (code: CounterpartyTypeCode) => valuesOf(code),
    typeOf,
    nameOf: (id: string | null | undefined) => (id ? (catalog.byId.get(id)?.name ?? null) : null),
  };
}

/** A value's label in a list: its code, when it has one, and its name. */
export function valueLabel(value: Pick<DimensionValue, 'code' | 'name'>): string {
  return value.code ? `${value.code} ${value.name}` : value.name;
}

/** A rate in basis points as a percentage, up to 2 decimals, no trailing zero ("10", "12.5"). */
export function basisPointsText(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = String(bp % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(whole) : `${whole}.${fraction}`;
}

/** A percentage as typed ("10", "12.5", "12.50") in basis points, or null outside 0–100. */
export function basisPointsOf(text: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bp <= 10_000 ? bp : null;
}

/** A document's kind and number as printed: `مستخلص 2026/3` (S12 "Arabic strings"). */
export function DocumentNumberText({
  document,
  startMonth,
  kind = true,
}: {
  document: {
    readonly kind: ProjectDocumentKind;
    readonly fiscalYear: number;
    readonly number: number;
  };
  startMonth: number;
  /** Shows the kind's name before the number. */
  kind?: boolean;
}) {
  return (
    <span>
      {kind && `${t.kinds[document.kind]} `}
      <bdi dir="ltr" className="tabular-nums">
        {formatEntryNumber(document, startMonth)}
      </bdi>
    </span>
  );
}

/** A document's state in words: posted, or cancelled by its reversal (rule 22). */
export function DocumentStateBadge({ cancelled }: { cancelled: boolean }) {
  return (
    <Badge tone={cancelled ? 'danger' : 'success'}>
      {cancelled ? t.states.cancelled : t.states.posted}
    </Badge>
  );
}

/**
 * Prints a project document (S12 "Printing and legal books"): its PDF is a report file the worker
 * renders, read again while queued, then downloaded.
 */
export function PrintDocumentButton({
  documentId,
  size = 'md',
  label = t.register.print,
}: {
  documentId: string;
  size?: 'md' | 'sm';
  label?: string;
}) {
  const { companyId } = useCompany();
  const file = useReportFile(companyId);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size={size}
        loading={file.request.isPending}
        onClick={() =>
          file.request.mutate({ report: 'project_document', params: { document: documentId } })
        }
      >
        <PrinterIcon aria-hidden="true" />
        {label}
      </Button>
      <ExportFileState
        labels={ar.reports.exportMenu}
        file={file.menuFile}
        onDownload={() => file.fetchFile.mutate()}
        downloading={file.fetchFile.isPending}
      />
      <FormError error={file.error} />
    </span>
  );
}

/** `BillingSummary`'s labels. */
export const billingSummaryLabels = {
  cumulative: t.form.cumulative,
  previous: t.preview.previous,
  period: t.preview.period,
  retention: t.preview.retention,
  recovery: ar.reports.project.columns.recovery,
  net: ar.reports.project.columns.net,
  unknown: t.form.notComputed,
};

/** The way back to the projects list. */
export function ProjectsBackLink() {
  return (
    <Button variant="ghost" size="sm" className="w-fit" render={<Link to="/projects" />}>
      <ArrowRightIcon aria-hidden="true" />
      {t.nav}
    </Button>
  );
}
