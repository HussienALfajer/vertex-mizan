import { type CurrencyCode, formatMinor, type ProjectDocumentKind } from '@vertex-mizan/contracts';
import type { Catalog } from '@vertex-mizan/i18n';
import { fontFamily, lightColors, palette } from '@vertex-mizan/tokens';
import type { ReactNode } from 'react';
import { entryNumberText } from './sheets.js';

/**
 * A printed project document (S12 "Printing and legal books"), in Arabic with the company, the
 * document's kind and number (`2026/15`), its date, its project and client, its counterparty, its
 * figures through the money module, the entry, who prepared and approved it, "ملغى" with the
 * reversal's number when cancelled, and its signature lines:
 * - a billing (A4): "المستخلص رقم n" of its project, the contract value, cumulative, previous and
 *   period's value, retention and recovery with their rates, the net due in figures and in words;
 * - a purchase (A5): the supplier's reference, each line with its account, material, quantity,
 *   unit, unit price and amount, the total in figures and words, any advance applied;
 * - a wage sheet (A4 landscape): the period, a row per line with the worker, days and daily rate
 *   or the lump sum's description, the amount and "توقيع العامل"; each worker's total, the sheet's
 *   in words;
 * - a retention release (A4): the retentions released with their documents, the amount in figures
 *   and in words.
 * Text arrives as props; no arithmetic happens here.
 */

interface Named {
  readonly code: string | null;
  readonly name: string;
}

interface EntryLink {
  readonly fiscalYear: number;
  readonly number: number;
}

/** A project document as `packages/db`'s `readProjectDocumentPrint()` reads it. */
export interface ProjectDocumentPrintData {
  readonly kind: ProjectDocumentKind;
  readonly fiscalYear: number;
  readonly number: number;
  readonly projectSequence: number | null;
  readonly documentDate: string;
  readonly currency: CurrencyCode;
  readonly project: Named;
  readonly client: Named | null;
  readonly counterparty: Named | null;
  readonly side: 'client' | 'supplier' | null;
  readonly supplierReference: string | null;
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
  readonly contractValueMinor: string | null;
  readonly retentionRate: string | null;
  readonly advanceRecoveryRate: string | null;
  readonly totalMinor: string;
  readonly cumulativeMinor: string | null;
  readonly previousMinor: string | null;
  readonly retentionMinor: string | null;
  readonly advanceMinor: string | null;
  readonly netMinor: string;
  readonly lines: readonly {
    readonly lineNo: number;
    readonly account: { readonly code: string; readonly name: string };
    readonly currency: CurrencyCode;
    readonly amountMinor: string;
    readonly material: { readonly code: string; readonly name: string } | null;
    readonly worker: string | null;
    readonly quantity: string | null;
    readonly unit: string | null;
    readonly unitPrice: string | null;
    readonly memo: string | null;
    readonly item: string | null;
  }[];
  readonly workerTotals: readonly { readonly worker: string; readonly amountMinor: string }[];
  readonly entry: EntryLink;
  readonly cancelledBy: EntryLink | null;
  readonly preparedBy: string | null;
  readonly approvedBy: string | null;
}

export type ProjectDocumentPrintText = Catalog['reports']['projectDocument'];

export interface ProjectDocumentPrintProps {
  readonly company: string;
  readonly document: ProjectDocumentPrintData;
  readonly text: ProjectDocumentPrintText;
  /** What the document comes to, in words (`amountInWords()` of `@vertex-mizan/i18n`). */
  readonly amountInWords: string;
  /** Each currency's printed name: SYP is "الليرة السورية الجديدة" (ADR 0007). */
  readonly currencyName: (currency: CurrencyCode) => string;
  readonly fiscalYearStartMonth: number;
}

const namedText = (value: Named) => (value.code ? `${value.code} ${value.name}` : value.name);

function Figure({ minor, currency }: { readonly minor: string; readonly currency: CurrencyCode }) {
  return (
    <bdi className={minor.startsWith('-') ? 'num neg' : 'num'}>
      {formatMinor(BigInt(minor), currency)}
    </bdi>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{children}</td>
    </tr>
  );
}

const replace = (template: string, key: string, value: ReactNode): ReactNode => {
  const [before, after] = template.split(`{${key}}`);
  return (
    <>
      {before}
      {value}
      {after}
    </>
  );
};

export function ProjectDocumentPrint({
  company,
  document,
  text,
  amountInWords,
  currencyName,
  fiscalYearStartMonth,
}: ProjectDocumentPrintProps) {
  const { kind, currency } = document;
  const money = (minor: string | null) =>
    minor === null ? null : (
      <>
        <Figure minor={minor} currency={currency} /> {currencyName(currency)}
      </>
    );
  const billing = kind === 'progress_billing' || kind === 'subcontract_billing';
  const counterpartyLabel =
    kind === 'subcontract_billing' || document.side === 'supplier'
      ? text.subcontractor
      : text.supplier;
  const rate = (value: string | null) =>
    value === null ? null : <bdi className="code"> {text.rate.replace('{rate}', value)}</bdi>;
  const signatures = billing ? text.signatures.billing : text.signatures.other;
  return (
    <main data-slot="project-document-print" data-kind={kind}>
      <header className="document-head">
        <div className="report-company">
          <bdi>{company}</bdi>
        </div>
        <h1 className="report-title">
          {text.kinds[kind]}
          {document.side === null ? null : ` — ${text.sides[document.side]}`}
        </h1>
        <div className="document-facts">
          <span>
            {text.number}: <bdi className="code">{`${document.fiscalYear}/${document.number}`}</bdi>
          </span>
          {document.projectSequence === null ? null : (
            <span>
              {replace(
                text.billingNumber,
                'number',
                <bdi className="code">{document.projectSequence}</bdi>,
              )}
            </span>
          )}
          <span>
            {text.date}: <bdi className="code">{document.documentDate}</bdi>
          </span>
        </div>
      </header>
      {document.cancelledBy === null ? null : (
        <div className="document-cancelled" data-slot="document-cancelled">
          {replace(
            text.cancelledBy,
            'number',
            <bdi className="code">
              {entryNumberText(document.cancelledBy, fiscalYearStartMonth)}
            </bdi>,
          )}
        </div>
      )}
      <table className="document-fields">
        <tbody>
          <Field label={text.project}>
            <bdi>{namedText(document.project)}</bdi>
          </Field>
          {document.client === null ? null : (
            <Field label={text.client}>
              <bdi>{namedText(document.client)}</bdi>
            </Field>
          )}
          {document.counterparty === null ? null : (
            <Field label={counterpartyLabel}>
              <bdi>{namedText(document.counterparty)}</bdi>
            </Field>
          )}
          {document.supplierReference === null ? null : (
            <Field label={text.supplierReference}>
              <bdi>{document.supplierReference}</bdi>
            </Field>
          )}
          {document.periodFrom === null || document.periodTo === null ? null : (
            <Field label={text.period}>
              <bdi className="code">{`${document.periodFrom} – ${document.periodTo}`}</bdi>
            </Field>
          )}
          <Field label={text.currency}>{currencyName(currency)}</Field>
          {billing ? (
            <>
              {document.contractValueMinor === null ? null : (
                <Field label={text.contractValue}>{money(document.contractValueMinor)}</Field>
              )}
              <Field label={text.cumulative}>{money(document.cumulativeMinor)}</Field>
              <Field label={text.previous}>{money(document.previousMinor)}</Field>
              <Field label={text.periodValue}>{money(document.totalMinor)}</Field>
              <Field label={text.retention}>
                {money(document.retentionMinor ?? '0')}
                {rate(document.retentionRate)}
              </Field>
              <Field label={text.recovery}>
                {money(document.advanceMinor ?? '0')}
                {rate(document.advanceRecoveryRate)}
              </Field>
              <Field label={text.net}>
                <b>{money(document.netMinor)}</b>
              </Field>
            </>
          ) : (
            <>
              <Field label={kind === 'retention_release' ? text.released : text.total}>
                <b>{money(document.totalMinor)}</b>
              </Field>
              {document.advanceMinor === null || document.advanceMinor === '0' ? null : (
                <Field label={text.advanceApplied}>{money(document.advanceMinor)}</Field>
              )}
            </>
          )}
          <Field label={text.inWords}>{amountInWords}</Field>
        </tbody>
      </table>
      {document.lines.length === 0 ? null : <DocumentLines document={document} text={text} />}
      {document.workerTotals.length === 0 ? null : (
        <table className="document-lines document-totals">
          <caption>{text.workerTotals}</caption>
          <tbody>
            {document.workerTotals.map((total) => (
              <tr key={total.worker}>
                <td>
                  <bdi>{total.worker}</bdi>
                </td>
                <td className="num">{money(total.amountMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="document-people">
        <span>
          {text.entry}:{' '}
          <bdi className="code">{entryNumberText(document.entry, fiscalYearStartMonth)}</bdi>
        </span>
        {document.preparedBy === null ? null : (
          <span>
            {text.preparedBy}: <bdi>{document.preparedBy}</bdi>
          </span>
        )}
        {document.approvedBy === null ? null : (
          <span>
            {text.approvedBy}: <bdi>{document.approvedBy}</bdi>
          </span>
        )}
      </div>
      <footer className="document-signatures">
        {signatures.map((label) => (
          <div key={label} className="document-signature">
            <span>{label}</span>
          </div>
        ))}
      </footer>
    </main>
  );
}

function DocumentLines({
  document,
  text,
}: {
  readonly document: ProjectDocumentPrintData;
  readonly text: ProjectDocumentPrintText;
}) {
  const amount = (line: ProjectDocumentPrintData['lines'][number]) => (
    <Figure minor={line.amountMinor} currency={line.currency} />
  );
  if (document.kind === 'wage_sheet') {
    return (
      <table className="document-lines">
        <caption>{text.lines}</caption>
        <thead>
          <tr>
            <th>{text.worker}</th>
            <th className="num">{text.days}</th>
            <th>{`${text.dailyRate} / ${text.lumpSum}`}</th>
            <th className="num">{text.amount}</th>
            <th className="signature">{text.workerSignature}</th>
          </tr>
        </thead>
        <tbody>
          {document.lines.map((line) => (
            <tr key={line.lineNo}>
              <td>{line.worker === null ? null : <bdi>{line.worker}</bdi>}</td>
              <td className="num">{line.quantity}</td>
              <td>
                {line.unitPrice === null ? (
                  <bdi>{line.memo ?? ''}</bdi>
                ) : (
                  <bdi className="code">{line.unitPrice}</bdi>
                )}
              </td>
              <td className="num">{amount(line)}</td>
              <td className="signature" />
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (document.kind === 'retention_release') {
    return (
      <table className="document-lines">
        <caption>{text.lines}</caption>
        <thead>
          <tr>
            <th>{text.item}</th>
            <th>{text.account}</th>
            <th className="num">{text.amount}</th>
          </tr>
        </thead>
        <tbody>
          {document.lines.map((line) => (
            <tr key={line.lineNo}>
              <td>{line.item === null ? null : <bdi>{line.item}</bdi>}</td>
              <td>
                <bdi>{`${line.account.code} ${line.account.name}`}</bdi>
              </td>
              <td className="num">{amount(line)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <table className="document-lines">
      <caption>{text.lines}</caption>
      <thead>
        <tr>
          <th>{text.account}</th>
          <th>{text.material}</th>
          <th className="num">{text.quantity}</th>
          <th>{text.unit}</th>
          <th className="num">{text.unitPrice}</th>
          <th className="num">{text.amount}</th>
        </tr>
      </thead>
      <tbody>
        {document.lines.map((line) => (
          <tr key={line.lineNo}>
            <td>
              <bdi>{`${line.account.code} ${line.account.name}`}</bdi>
              {line.memo ? (
                <div className="document-memo">
                  <bdi>{line.memo}</bdi>
                </div>
              ) : null}
            </td>
            <td>
              {line.material === null ? null : (
                <bdi>{`${line.material.code} ${line.material.name}`}</bdi>
              )}
            </td>
            <td className="num">{line.quantity}</td>
            <td>{line.unit === null ? null : <bdi>{line.unit}</bdi>}</td>
            <td className="num">{line.unitPrice}</td>
            <td className="num">{amount(line)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Each kind's page: a purchase on A5, a wage sheet on landscape A4, the rest on portrait A4. */
export function projectDocumentPage(kind: ProjectDocumentKind): string {
  if (kind === 'purchase') return 'A5 portrait';
  if (kind === 'wage_sheet') return 'A4 landscape';
  return 'A4 portrait';
}

/** A project document's page, ink on white, logical properties only. */
export function projectDocumentStyles(kind: ProjectDocumentKind): string {
  const ink = lightColors.foreground;
  const muted = lightColors.mutedForeground;
  const rule = lightColors.border;
  const band = lightColors.muted;
  const negative = lightColors.negative;
  const brand = palette.green[800];
  const fonts = fontFamily.map((family) => (family.includes(' ') ? `"${family}"` : family));
  return `
@page { size: ${projectDocumentPage(kind)}; margin: 10mm 9mm; }
* { box-sizing: border-box; }
html { direction: rtl; }
body { margin: 0; color: ${ink}; background: ${palette.white}; font-family: ${fonts.join(', ')}; font-size: 9pt; line-height: 1.5; font-variant-numeric: tabular-nums; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.document-head { border-block-end: 0.6pt solid ${brand}; padding-block-end: 2mm; margin-block-end: 3mm; }
.report-company { font-size: 10pt; font-weight: 700; color: ${brand}; }
.report-title { font-size: 14pt; font-weight: 700; margin-block: 1mm; }
.document-facts { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 1mm 4mm; }
.document-cancelled { border: 1.2pt solid ${negative}; color: ${negative}; font-size: 14pt; font-weight: 700; text-align: center; padding-block: 1mm; margin-block-end: 3mm; }
table { inline-size: 100%; border-collapse: collapse; }
.document-fields th { inline-size: 40mm; text-align: start; font-weight: 700; color: ${muted}; padding: 1mm; vertical-align: top; }
.document-fields td { padding: 1mm; border-block-end: 0.3pt solid ${rule}; overflow-wrap: anywhere; }
.document-lines { margin-block-start: 4mm; }
.document-lines caption { text-align: start; font-weight: 700; margin-block-end: 1mm; }
.document-lines th { background: ${band}; border-block-end: 0.6pt solid ${ink}; padding: 1mm; text-align: start; font-weight: 700; }
.document-lines td { padding: 1mm; border-block-end: 0.3pt solid ${rule}; vertical-align: top; overflow-wrap: anywhere; }
.document-lines tr { break-inside: avoid; }
.document-lines thead { display: table-header-group; }
.document-lines .signature { inline-size: 35mm; }
.document-memo { color: ${muted}; font-size: 8pt; }
.num { direction: ltr; unicode-bidi: isolate; text-align: end; white-space: nowrap; }
th.num { text-align: end; }
.code { direction: ltr; unicode-bidi: isolate; }
.neg { color: ${negative}; }
.document-people { display: flex; flex-wrap: wrap; gap: 1mm 6mm; margin-block-start: 4mm; color: ${muted}; }
.document-signatures { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4mm; margin-block-start: 14mm; break-inside: avoid; }
.document-signature { border-block-start: 0.6pt solid ${ink}; padding-block-start: 1mm; text-align: center; }
`;
}
