import { useQuery } from '@tanstack/react-query';
import type { InboxActionPreview, InboxPreviewQuery } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  Amount,
  Callout,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { CirclePauseIcon } from 'lucide-react';
import { FormError } from '../../components/form-error';
import { formatDay } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { detailText, reasonLabel } from '../inbox/inbox-parts';
import { formatMonth, useLedgerCurrencies } from './revenue-parts';
import { inboxActionPreviewQuery } from './revenue-queries';

const t = ar.revenue.previewEntries;

/** An action of S06 rule 16 previewed: loaded, failed, or its outcome and entries. */
export function ActionPreviewPanel({
  id,
  query,
  enabled = true,
}: {
  id: string;
  query: InboxPreviewQuery;
  enabled?: boolean;
}) {
  const { companyId } = useCompany();
  const preview = useQuery({ ...inboxActionPreviewQuery(companyId, id, query), enabled });
  if (preview.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <span className="sr-only">{t.loading}</span>
        <Skeleton className="h-row" />
        <Skeleton className="h-row" />
      </div>
    );
  }
  if (preview.isError) return <FormError error={preview.error} />;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {query.action === 'recognise-in-open-period' && <ClosedParts preview={preview.data} />}
      <PreviewEntries preview={preview.data} />
    </div>
  );
}

/** The closed months whose elapsed parts post in the first open period, with that day. */
export function ClosedParts({ preview }: { preview: InboxActionPreview }) {
  const moved = preview.entries.filter(
    (entry) => entry.servicePeriodOn !== null && entry.servicePeriodOn !== entry.date,
  );
  if (moved.length === 0) return null;
  const r = ar.revenue.actions.recognise;
  return (
    <Table aria-label={r.closedPartsLabel}>
      <TableHeader>
        <TableRow>
          <TableHead>{r.month}</TableHead>
          <TableHead>{r.postsOn}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {moved.map((entry) => (
          <TableRow key={`${entry.servicePeriodOn}-${entry.date}`}>
            <TableCell>{formatMonth((entry.servicePeriodOn ?? '').slice(0, 7))}</TableCell>
            <TableCell>{formatDay(entry.date)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** A previewed action's outcome, then each entry it would post with its lines in every ledger. */
export function PreviewEntries({ preview }: { preview: InboxActionPreview }) {
  const { companyId } = useCompany();
  const currencies = useLedgerCurrencies(companyId);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {preview.state === 'held' && (
        <Callout
          tone="warning"
          icon={<CirclePauseIcon />}
          title={
            <>
              {`${t.held} `}
              {reasonLabel(preview.reason)}
            </>
          }
          description={preview.detail ? detailText(preview.detail) : undefined}
        />
      )}
      {preview.state === 'recorded' && <p className="text-muted-foreground">{t.recorded}</p>}
      {preview.state === 'posted' && preview.entries.length === 0 && (
        <p className="text-muted-foreground">{t.none}</p>
      )}
      {preview.entries.map((entry, index) => {
        const label = (
          <>
            {`${t.entryLabel} `}
            {formatDay(entry.date)}
            {entry.source === 'revenue_release' && ` · ${t.release}`}
            {entry.servicePeriodOn && (
              <>
                {` · ${t.elapsedOf} `}
                {formatMonth(entry.servicePeriodOn.slice(0, 7))}
              </>
            )}
          </>
        );
        const labelId = `preview-entry-${index}`;
        return (
          <section
            // Entries keep their posting order; nothing reorders them.
            // biome-ignore lint/suspicious/noArrayIndexKey: a previewed entry has no id
            key={index}
            aria-labelledby={labelId}
            className="flex min-w-0 flex-col gap-2"
          >
            <h3 id={labelId} className="font-medium">
              {label}
            </h3>
            <Table aria-labelledby={labelId}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.account}</TableHead>
                  <TableHead numeric>{t.transaction}</TableHead>
                  <TableHead numeric className="max-sm:hidden">
                    {t.book}
                  </TableHead>
                  {currencies.parallel && (
                    <TableHead numeric className="max-sm:hidden">
                      {t.parallel}
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {entry.lines.map((line, lineIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a previewed line has no id
                  <TableRow key={lineIndex}>
                    <TableCell>
                      <AccountLabel code={line.accountCode} name={line.accountName} />
                    </TableCell>
                    <TableCell numeric>
                      <Amount
                        value={BigInt(line.amount.amountMinor)}
                        currency={line.amount.currency}
                        showCurrency
                      />
                    </TableCell>
                    <TableCell numeric className="max-sm:hidden">
                      {currencies.book && (
                        <Amount value={BigInt(line.bookMinor)} currency={currencies.book} />
                      )}
                    </TableCell>
                    {currencies.parallel && (
                      <TableCell numeric className="max-sm:hidden">
                        {line.parallelMinor !== null && (
                          <Amount
                            value={BigInt(line.parallelMinor)}
                            currency={currencies.parallel}
                          />
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        );
      })}
    </div>
  );
}
