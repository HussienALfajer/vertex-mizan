import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type Account,
  ATTACHMENT_CONTENT_TYPES,
  ATTACHMENT_LIMIT,
  type Attachment,
  attachmentSchema,
  type CurrencyCode,
  type DimensionValue,
  type EntryLine,
  type EntryNumber,
  type LineConversion,
  money,
  summarizeAmounts,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  type AccountPickerOption,
  Amount,
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Digest,
  type DimensionPickerOption,
  FileUploadButton,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { ArrowRightIcon, DownloadIcon, Trash2Icon } from 'lucide-react';
import type { ReactNode } from 'react';
import { FormError } from '../../components/form-error';
import { api, download, upload } from '../../lib/api';
import { formatDateTime, formatDay, formatEntryNumber, formatKilobytes } from '../../lib/format';
import { companyQuery } from '../company/company-queries';

const t = ar.entries;

/** The account picker's labels on the entry screens. */
export const accountPickerLabels = {
  ...ar.chart.picker,
  header: ar.accounting.account.header,
  blocked: ar.accounting.account.blocked,
};

/** Accounts as the account picker lists them; `manual` leaves out control accounts (rule 16). */
export function pickerAccounts(
  accounts: readonly Account[],
  { manual = false }: { manual?: boolean } = {},
): AccountPickerOption[] {
  return accounts
    .filter((account) => !(manual && account.isControl))
    .map((account) => ({
      id: account.id,
      code: account.code,
      name: account.name,
      nameLatin: account.nameLatin,
      kind: account.kind,
      blocked: account.blocked !== null,
      archived: account.archived !== null,
    }));
}

/** Dimension values as the dimension picker lists them. */
export function pickerValues(values: readonly DimensionValue[]): DimensionPickerOption[] {
  return values.map((value) => ({
    id: value.id,
    code: value.code,
    name: value.name,
    nameLatin: value.nameLatin,
    detail: value.parentName,
    archived: value.archivedAt !== null,
  }));
}

/** The dimension picker's labels on the entry screens. */
export const dimensionPickerLabels = ar.dimensions.picker;

/** The month the company's fiscal year starts in, for entry numbers (1 while it loads). */
export function useFiscalYearStartMonth(companyId: string): number {
  return useQuery(companyQuery(companyId)).data?.fiscalYearStartMonth ?? 1;
}

/** An entry's number, `2026/123` or `2026-27/123`, as one LTR isolate (S03 "Periods"). */
export function EntryNumberText({
  number,
  startMonth,
}: {
  number: EntryNumber;
  startMonth: number;
}) {
  return (
    <bdi dir="ltr" className="tabular-nums">
      {formatEntryNumber(number, startMonth)}
    </bdi>
  );
}

/** The way back from a sub-page, above its title. */
export function BackLink({ to, label }: { to: '/entries' | '/drafts'; label: string }) {
  return (
    <Button variant="ghost" size="sm" className="w-fit" render={<Link to={to} />}>
      <ArrowRightIcon aria-hidden="true" />
      {label}
    </Button>
  );
}

/** The dimension values a line carries, by name (a value's code shown first when it has one). */
export function DimensionNames({
  ids,
  byId,
}: {
  ids: readonly string[];
  byId: ReadonlyMap<string, DimensionValue>;
}) {
  if (ids.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {ids.map((id) => {
        const value = byId.get(id);
        return (
          <Badge key={id} tone="outline">
            {value?.code && <bdi dir="ltr">{value.code}</bdi>}
            <bdi>{value?.name ?? '…'}</bdi>
          </Badge>
        );
      })}
    </span>
  );
}

/** How a ledger amount was converted: `1 USD = 121.5 SYP`, the rate type and its date. */
export function Conversions({ conversions }: { conversions: readonly LineConversion[] }) {
  if (conversions.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      {conversions.map((conversion) => (
        <li
          key={`${conversion.ledger}-${conversion.quoteNo}`}
          className="flex flex-wrap items-center gap-x-2"
        >
          <span>{conversion.ledger === 'book' ? t.entry.book : t.entry.parallel}:</span>
          <bdi dir="ltr" className="tabular-nums">
            {`1 ${conversion.base} = ${conversion.rate} ${conversion.quote}`}
          </bdi>
          <span>
            {conversion.basis === 'transaction'
              ? t.entry.dealt
              : `${ar.rates.types[conversion.rateType]} · ${formatDay(conversion.effectiveOn)}`}
          </span>
          {conversion.rateId && (
            <Link to="/rates" className="text-primary underline-offset-4 hover:underline">
              {t.entry.rateRow}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A ledger column's total over the lines, through the money module. */
function ledgerSum(
  lines: readonly EntryLine[],
  ledger: 'book' | 'parallel',
  currency: CurrencyCode,
) {
  const amounts = lines.flatMap((line) => {
    const value = ledger === 'book' ? line.bookMinor : line.parallelMinor;
    return value === null ? [] : [money(BigInt(value), currency)];
  });
  return summarizeAmounts(amounts)[0]?.sumMinor ?? 0n;
}

/**
 * Posted or previewed lines (S03 "Screens"): account, dimensions, kind, the transaction amount and
 * both ledgers' amounts, with each conversion's rate. Rounding and difference lines say so and
 * name their one ledger. Wide: the table scrolls inside itself on a phone.
 */
export function EntryLinesTable({
  label,
  lines,
  bookCurrency,
  parallelCurrency,
  dimensions,
  accountLink = true,
}: {
  label: string;
  lines: readonly EntryLine[];
  bookCurrency: CurrencyCode;
  parallelCurrency: CurrencyCode | null;
  dimensions: ReadonlyMap<string, DimensionValue>;
  accountLink?: boolean;
}) {
  return (
    <Table aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.entry.line}</TableHead>
          <TableHead>{t.entry.account}</TableHead>
          <TableHead>{t.entry.kind}</TableHead>
          <TableHead numeric>{t.entry.amount}</TableHead>
          <TableHead numeric>
            {`${t.entry.book} `}
            <bdi dir="ltr">{bookCurrency}</bdi>
          </TableHead>
          {parallelCurrency && (
            <TableHead numeric>
              {`${t.entry.parallel} `}
              <bdi dir="ltr">{parallelCurrency}</bdi>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <TableRow key={line.lineNo} data-kind={line.kind}>
            <TableCell>
              <bdi dir="ltr">{line.lineNo}</bdi>
            </TableCell>
            <TableCell className="align-top">
              <span className="flex flex-col gap-1">
                {accountLink ? (
                  <Link
                    to="/accounts/$id/lines"
                    params={{ id: line.accountId }}
                    className="underline-offset-4 hover:underline"
                  >
                    <AccountLabel code={line.accountCode} name={line.accountName} />
                  </Link>
                ) : (
                  <AccountLabel code={line.accountCode} name={line.accountName} />
                )}
                <DimensionNames ids={line.dimensionValueIds} byId={dimensions} />
                {line.memo && (
                  <span className="text-xs text-muted-foreground">
                    <bdi>{line.memo}</bdi>
                  </span>
                )}
                <Conversions conversions={line.conversions} />
              </span>
            </TableCell>
            <TableCell className="align-top">
              {line.kind === 'measured' ? (
                t.kinds.measured
              ) : (
                <span className="flex flex-col items-start gap-1">
                  <Badge tone={line.kind === 'difference' ? 'warning' : 'info'}>
                    {t.kinds[line.kind]}
                  </Badge>
                  {line.ledger && (
                    <span className="text-xs text-muted-foreground">
                      {`${line.ledger === 'book' ? t.entry.book : t.entry.parallel} · ${t.entry.oneLedger}`}
                    </span>
                  )}
                </span>
              )}
            </TableCell>
            <TableCell numeric className="align-top">
              <Amount value={BigInt(line.amountMinor)} currency={line.currency} showCurrency />
            </TableCell>
            <TableCell numeric className="align-top">
              <Amount value={BigInt(line.bookMinor)} currency={bookCurrency} />
            </TableCell>
            {parallelCurrency && (
              <TableCell numeric className="align-top">
                {line.parallelMinor !== null && (
                  <Amount value={BigInt(line.parallelMinor)} currency={parallelCurrency} />
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
        <TableRow>
          <TableCell colSpan={3} className="font-medium">
            {t.entry.total}
          </TableCell>
          <TableCell />
          <TableCell numeric>
            <Amount value={ledgerSum(lines, 'book', bookCurrency)} currency={bookCurrency} strong />
          </TableCell>
          {parallelCurrency && (
            <TableCell numeric>
              <Amount
                value={ledgerSum(lines, 'parallel', parallelCurrency)}
                currency={parallelCurrency}
                strong
              />
            </TableCell>
          )}
        </TableRow>
      </TableBody>
    </Table>
  );
}

/** A label and its value, in the header of an entry or a draft. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

const ta = t.attachments;

/**
 * The files of a draft or an entry (S03 rule 17): name, size, SHA-256, who attached them, a
 * download through the API. Files are added while `uploadPath` is given and removed from a draft
 * only (`removePath`); a posted entry never loses one (owner, 2026-10-28).
 */
export function AttachmentsCard({
  companyId,
  attachments,
  uploadPath,
  removePath,
  invalidate,
  disabledNote,
}: {
  companyId: string;
  attachments: readonly Attachment[];
  uploadPath?: string | undefined;
  removePath?: ((attachment: Attachment) => string) | undefined;
  /** The query key whose data holds the attachments, read again after a change. */
  invalidate: readonly unknown[];
  /** Why files cannot be attached yet (an unsaved draft). */
  disabledNote?: string | undefined;
}) {
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: async (files: File[]) => {
      if (!uploadPath) return;
      // One at a time, in the chosen order: the limit of 20 is counted by the server.
      for (const file of files) {
        await upload(uploadPath, file, { company: companyId, schema: attachmentSchema });
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: invalidate }),
  });
  const remove = useMutation({
    mutationFn: (path: string) => api('DELETE', path, { company: companyId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invalidate }),
  });
  const fetchFile = useMutation({
    mutationFn: (attachment: Attachment) =>
      download(`/attachments/${attachment.id}`, { company: companyId }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{ta.title}</CardTitle>
        <CardDescription>{disabledNote ?? ta.hint}</CardDescription>
      </CardHeader>
      <div className="flex min-w-0 flex-col gap-4 px-6 pb-6">
        {attachments.length === 0 ? (
          <p className="text-muted-foreground">{ta.empty}</p>
        ) : (
          <Table aria-label={ta.label}>
            <TableHeader>
              <TableRow>
                <TableHead>{ta.name}</TableHead>
                <TableHead numeric>{ta.size}</TableHead>
                <TableHead className="max-md:hidden">{ta.digest}</TableHead>
                <TableHead className="max-lg:hidden">{ta.uploadedBy}</TableHead>
                <TableHead>
                  <span className="sr-only">{ta.download}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attachments.map((attachment) => (
                <TableRow key={attachment.id}>
                  <TableCell className="max-w-48 truncate">
                    <bdi>{attachment.fileName}</bdi>
                  </TableCell>
                  <TableCell numeric>
                    <bdi dir="ltr">{formatKilobytes(attachment.sizeBytes)}</bdi>
                    {` ${ta.kilobytes}`}
                  </TableCell>
                  <TableCell className="max-md:hidden">
                    <Digest
                      value={attachment.sha256}
                      copyLabel={ta.copyDigest}
                      copiedLabel={t.entry.copied}
                    />
                  </TableCell>
                  <TableCell className="max-lg:hidden">
                    <span className="flex flex-col">
                      <bdi>{attachment.uploadedBy.name}</bdi>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(attachment.createdAt)}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex justify-end gap-1">
                      <IconButton
                        label={`${ta.download}: ${attachment.fileName}`}
                        onClick={() => fetchFile.mutate(attachment)}
                      >
                        <DownloadIcon aria-hidden="true" />
                      </IconButton>
                      {removePath && (
                        <IconButton
                          label={`${ta.remove}: ${attachment.fileName}`}
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(removePath(attachment))}
                        >
                          <Trash2Icon aria-hidden="true" />
                        </IconButton>
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <FormError error={add.error ?? remove.error ?? fetchFile.error} />
        {uploadPath && (
          <FileUploadButton
            className="w-fit"
            label={t.actions.attach}
            accept={ATTACHMENT_CONTENT_TYPES}
            multiple
            loading={add.isPending}
            disabled={attachments.length >= ATTACHMENT_LIMIT}
            onFiles={(files) => add.mutate(files)}
          />
        )}
      </div>
    </Card>
  );
}
