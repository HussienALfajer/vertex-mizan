import type { VoucherKind, VoucherState } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { Badge, Button, ExportFileState } from '@vertex-mizan/ui';
import { PrinterIcon } from 'lucide-react';
import { FormError } from '../../components/form-error';
import { formatEntryNumber } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { useReportFile } from '../reports/report-parts';

/** A voucher's number as printed: its kind and `<year>/<number>` (S11 "Arabic strings"). */
export function voucherNumberText(
  voucher: { readonly fiscalYear: number; readonly number: number },
  startMonth: number,
): string {
  return formatEntryNumber(voucher, startMonth);
}

/** A voucher's kind and number, the number an LTR isolate. */
export function VoucherNumberText({
  voucher,
  startMonth,
}: {
  voucher: { readonly kind: VoucherKind; readonly fiscalYear: number; readonly number: number };
  startMonth: number;
}) {
  return (
    <span>
      {`${ar.cash.kinds[voucher.kind]} `}
      <bdi dir="ltr" className="tabular-nums">
        {voucherNumberText(voucher, startMonth)}
      </bdi>
    </span>
  );
}

/** A voucher's state in words: posted, or cancelled by its reversal (rule 14). */
export function VoucherStateBadge({ state }: { state: VoucherState }) {
  return <Badge tone={state === 'cancelled' ? 'danger' : 'success'}>{ar.cash.states[state]}</Badge>;
}

/**
 * Prints a voucher (S11 "Printing and legal books"): its PDF is a report file the worker renders,
 * read again while queued, then downloaded.
 */
export function PrintVoucherButton({
  voucherId,
  size = 'md',
}: {
  voucherId: string;
  size?: 'md' | 'sm';
}) {
  const { companyId } = useCompany();
  const file = useReportFile(companyId);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size={size}
        loading={file.request.isPending}
        onClick={() => file.request.mutate({ report: 'voucher', params: { voucher: voucherId } })}
      >
        <PrinterIcon aria-hidden="true" />
        {ar.cash.form.print}
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
