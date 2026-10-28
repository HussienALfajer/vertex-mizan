import { Link } from '@tanstack/react-router';
import {
  type EntryPreview,
  errorCodeSchema,
  type PostingRefusal,
  rateTypeSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { Callout, Card, CardDescription, CardHeader, CardTitle } from '@vertex-mizan/ui';
import { CircleAlertIcon, TriangleAlertIcon } from 'lucide-react';
import { formatDay } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { EntryLinesTable } from './entry-parts';
import { useDimensionCatalog } from './entry-queries';

const t = ar.drafts;

/**
 * A refusal of the posting function or of rule 5, in Arabic: its code's text, what is missing,
 * and for a missing rate the pair, the rate type and the date it was needed on.
 */
export function refusalText(refusal: Pick<PostingRefusal, 'code' | 'details'>): string {
  const { code, details } = refusal;
  if (code === 'VALIDATION_FAILED') {
    if (details.field === 'description') return t.editor.validation.statement;
    return t.editor.validation.incomplete;
  }
  const known = errorCodeSchema.safeParse(code);
  const text = known.success ? ar.errors[known.data] : ar.common.errorDescription;
  if (code === 'RATE_MISSING' && details.from && details.to) {
    const type = rateTypeSchema.safeParse(details.rateType);
    return [
      text,
      `${details.from}/${details.to}`,
      type.success ? ar.rates.types[type.data] : undefined,
      details.on ? formatDay(details.on) : undefined,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (code === 'ENTRY_UNBALANCED' && details.currency) return `${text} (${details.currency})`;
  return text;
}

/**
 * The refusals of a preview or a posting, each with its line when it names one. `rowOf` turns a
 * saved line number into the row the screen shows it on (blank rows are not saved).
 */
export function Refusals({
  refusals,
  rowOf = (lineNo) => lineNo,
}: {
  refusals: readonly PostingRefusal[];
  rowOf?: (lineNo: number) => number;
}) {
  return (
    <Callout
      role="alert"
      tone="danger"
      icon={<CircleAlertIcon />}
      title={t.preview.refusals}
      description={
        <ul className="flex flex-col gap-1">
          {refusals.map((refusal, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: refusals have no identity but their order.
              key={index}
              className="flex flex-wrap items-baseline gap-x-2"
            >
              {refusal.lineNo !== null && (
                <span className="font-medium">
                  {`${t.preview.line} `}
                  <bdi dir="ltr">{rowOf(refusal.lineNo)}</bdi>:
                </span>
              )}
              <span>{refusalText(refusal)}</span>
              {refusal.code === 'RATE_MISSING' && (
                <Link to="/rates" className="text-primary underline underline-offset-4">
                  {t.preview.openRates}
                </Link>
              )}
            </li>
          ))}
        </ul>
      }
    />
  );
}

/**
 * The posting preview (S03 rule 7): every line as it would post now, in both ledgers, with the
 * rates and the rounding and difference lines; or why the draft cannot post. Computed by the
 * posting function's own code, with no write.
 */
export function PreviewPanel({
  preview,
  stale,
  rowOf,
}: {
  preview: EntryPreview;
  stale: boolean;
  rowOf: (lineNo: number) => number;
}) {
  const { companyId } = useCompany();
  const dimensions = useDimensionCatalog(companyId);
  return (
    <Card data-slot="preview">
      <CardHeader>
        <CardTitle>{t.preview.title}</CardTitle>
        <CardDescription>{t.preview.description}</CardDescription>
      </CardHeader>
      <div className="flex min-w-0 flex-col gap-4 px-6 pb-6">
        {stale && <Callout tone="warning" icon={<TriangleAlertIcon />} title={t.preview.stale} />}
        {preview.refusals.length > 0 ? (
          <Refusals refusals={preview.refusals} rowOf={rowOf} />
        ) : (
          <EntryLinesTable
            label={t.preview.label}
            lines={preview.lines}
            bookCurrency={preview.bookCurrency}
            parallelCurrency={preview.parallelCurrency}
            dimensions={dimensions.byId}
            accountLink={false}
          />
        )}
      </div>
    </Card>
  );
}
