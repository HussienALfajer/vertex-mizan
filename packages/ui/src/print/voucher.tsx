import {
  type CurrencyCode,
  formatMinor,
  type VoucherKind,
  type VoucherState,
} from '@vertex-mizan/contracts';
import { fontFamily, lightColors, palette } from '@vertex-mizan/tokens';
import type { ReactNode } from 'react';
import { entryNumberText } from './sheets.js';

/**
 * The printed voucher (S11 "Printing and legal books"): one A5 portrait page in Arabic with the
 * company, the voucher's kind, number and date, its cash account (a transfer's both), the amount in
 * figures through the money module and in words, the party, the description, each counter line,
 * a transfer's amounts, dealt rate and fee, a count's expected and counted amounts, the entry, who
 * prepared and approved it, and the four signature lines. A cancelled voucher prints "ملغى" with
 * its reversal's number. Text arrives as props; no arithmetic happens here.
 */

interface PrintedAccount {
  readonly code: string;
  readonly name: string;
  readonly currency: CurrencyCode;
}

interface EntryLink {
  readonly fiscalYear: number;
  readonly number: number;
}

/** A voucher as `packages/db`'s `readVoucherPrint()` reads it. */
export interface VoucherPrintData {
  readonly kind: VoucherKind;
  readonly fiscalYear: number;
  readonly number: number;
  readonly date: string;
  readonly state: VoucherState;
  readonly cashAccount: PrintedAccount;
  readonly counterCashAccount: PrintedAccount | null;
  /** The cash account's movement, a magnitude in its currency. */
  readonly amountMinor: string;
  readonly partyName: string | null;
  readonly description: string;
  readonly entry: EntryLink | null;
  readonly reversal: EntryLink | null;
  readonly expectedMinor: string | null;
  readonly countedMinor: string | null;
  readonly differenceMinor: string | null;
  readonly destinationMinor: string | null;
  /** A transfer's fee and what it exchanged net of the fee, in the source's currency. */
  readonly feeMinor: string | null;
  readonly exchangedMinor: string | null;
  readonly dealtRate: {
    readonly base: CurrencyCode;
    readonly quote: CurrencyCode;
    readonly rate: string;
  } | null;
  readonly preparedBy: string | null;
  readonly approvedBy: string | null;
  readonly lines: readonly {
    readonly lineNo: number;
    readonly account: { readonly code: string; readonly name: string };
    readonly currency: CurrencyCode;
    readonly amountMinor: string;
    readonly counterparty: string | null;
    readonly contract: string | null;
    readonly memo: string | null;
  }[];
}

export interface VoucherPrintText {
  readonly kinds: Readonly<Record<VoucherKind, string>>;
  readonly exchange: string;
  readonly print: {
    readonly number: string;
    readonly date: string;
    readonly cashAccount: string;
    readonly source: string;
    readonly destination: string;
    readonly amount: string;
    readonly amountInWords: string;
    readonly receivedFrom: string;
    readonly paidTo: string;
    readonly description: string;
    readonly lines: string;
    readonly account: string;
    readonly counterparty: string;
    readonly contract: string;
    readonly sourceAmount: string;
    readonly destinationAmount: string;
    readonly dealtRate: string;
    readonly fee: string;
    readonly sourceTotal: string;
    readonly expected: string;
    readonly counted: string;
    readonly difference: string;
    readonly reason: string;
    readonly entry: string;
    readonly preparedBy: string;
    readonly approvedBy: string;
    readonly cancelled: string;
    readonly cancelledBy: string;
    readonly signatures: {
      readonly receiver: string;
      readonly cashier: string;
      readonly accountant: string;
      readonly manager: string;
    };
  };
}

export interface VoucherPrintProps {
  readonly company: string;
  readonly voucher: VoucherPrintData;
  readonly text: VoucherPrintText;
  /** The amount in words, from `@vertex-mizan/i18n`'s `amountInWords()`. */
  readonly amountInWords: string;
  /** Each currency's printed name: SYP is "الليرة السورية الجديدة" (ADR 0007). */
  readonly currencyName: (currency: CurrencyCode) => string;
  readonly fiscalYearStartMonth: number;
}

const accountText = (account: { readonly code: string; readonly name: string }) =>
  `${account.code} ${account.name}`;

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

export function VoucherPrint({
  company,
  voucher,
  text,
  amountInWords,
  currencyName,
  fiscalYearStartMonth,
}: VoucherPrintProps) {
  const p = text.print;
  const number = (link: EntryLink) => entryNumberText(link, fiscalYearStartMonth);
  const currency = voucher.cashAccount.currency;
  const exchange =
    voucher.kind === 'transfer' &&
    voucher.counterCashAccount !== null &&
    voucher.counterCashAccount.currency !== currency;
  const title = exchange ? `${text.kinds.transfer} (${text.exchange})` : text.kinds[voucher.kind];
  const shown = voucher.kind === 'count' ? (voucher.countedMinor ?? '0') : voucher.amountMinor;
  const party =
    voucher.kind === 'receipt' ? p.receivedFrom : voucher.kind === 'payment' ? p.paidTo : null;
  return (
    <main data-slot="voucher-print" data-kind={voucher.kind} data-state={voucher.state}>
      <header className="voucher-head">
        <div className="report-company">
          <bdi>{company}</bdi>
        </div>
        <h1 className="report-title">{title}</h1>
        <div className="voucher-facts">
          <span>
            {p.number}: <bdi className="code">{number(voucher)}</bdi>
          </span>
          <span>
            {p.date}: <bdi className="code">{voucher.date}</bdi>
          </span>
        </div>
      </header>
      {voucher.state === 'cancelled' ? (
        <div className="voucher-cancelled" data-slot="voucher-cancelled">
          {voucher.reversal === null ? (
            p.cancelled
          ) : (
            <>
              {p.cancelledBy.split('{number}')[0]}
              <bdi className="code">{number(voucher.reversal)}</bdi>
              {p.cancelledBy.split('{number}')[1]}
            </>
          )}
        </div>
      ) : null}
      <table className="voucher-fields">
        <tbody>
          {voucher.kind === 'transfer' && voucher.counterCashAccount !== null ? (
            <>
              <Field label={p.source}>{accountText(voucher.cashAccount)}</Field>
              <Field label={p.destination}>{accountText(voucher.counterCashAccount)}</Field>
              <Field label={p.sourceAmount}>
                <Figure minor={voucher.exchangedMinor ?? voucher.amountMinor} currency={currency} />{' '}
                {currencyName(currency)}
              </Field>
              {voucher.destinationMinor === null ? null : (
                <Field label={p.destinationAmount}>
                  <Figure
                    minor={voucher.destinationMinor}
                    currency={voucher.counterCashAccount.currency}
                  />{' '}
                  {currencyName(voucher.counterCashAccount.currency)}
                </Field>
              )}
              {voucher.dealtRate === null ? null : (
                <Field label={p.dealtRate}>
                  <bdi className="code">
                    1 {voucher.dealtRate.base} = {voucher.dealtRate.rate} {voucher.dealtRate.quote}
                  </bdi>
                </Field>
              )}
              {voucher.feeMinor !== null && voucher.feeMinor !== '0' && (
                <>
                  <Field label={p.fee}>
                    <Figure minor={voucher.feeMinor} currency={currency} /> {currencyName(currency)}
                  </Field>
                  <Field label={p.sourceTotal}>
                    <Figure minor={voucher.amountMinor} currency={currency} />{' '}
                    {currencyName(currency)}
                  </Field>
                </>
              )}
            </>
          ) : (
            <>
              <Field label={p.cashAccount}>{accountText(voucher.cashAccount)}</Field>
              <Field label={voucher.kind === 'count' ? p.counted : p.amount}>
                <Figure minor={shown} currency={currency} /> {currencyName(currency)}
              </Field>
            </>
          )}
          <Field label={p.amountInWords}>{amountInWords}</Field>
          {voucher.kind === 'count' ? (
            <>
              {voucher.expectedMinor === null ? null : (
                <Field label={p.expected}>
                  <Figure minor={voucher.expectedMinor} currency={currency} />{' '}
                  {currencyName(currency)}
                </Field>
              )}
              {voucher.differenceMinor === null ? null : (
                <Field label={p.difference}>
                  <Figure minor={voucher.differenceMinor} currency={currency} />{' '}
                  {currencyName(currency)}
                </Field>
              )}
            </>
          ) : null}
          {party !== null && voucher.partyName !== null ? (
            <Field label={party}>
              <bdi>{voucher.partyName}</bdi>
            </Field>
          ) : null}
          <Field label={voucher.kind === 'count' ? p.reason : p.description}>
            <bdi>{voucher.description}</bdi>
          </Field>
        </tbody>
      </table>
      {voucher.lines.length > 0 && voucher.kind !== 'transfer' ? (
        <table className="voucher-lines">
          <caption>{p.lines}</caption>
          <thead>
            <tr>
              <th>{p.account}</th>
              <th>{p.counterparty}</th>
              <th>{p.contract}</th>
              <th className="num">{p.amount}</th>
            </tr>
          </thead>
          <tbody>
            {voucher.lines.map((line) => (
              <tr key={line.lineNo}>
                <td>
                  <bdi>{accountText(line.account)}</bdi>
                  {line.memo ? (
                    <div className="voucher-memo">
                      <bdi>{line.memo}</bdi>
                    </div>
                  ) : null}
                </td>
                <td>{line.counterparty === null ? null : <bdi>{line.counterparty}</bdi>}</td>
                <td>{line.contract === null ? null : <bdi>{line.contract}</bdi>}</td>
                <td className="num">
                  <Figure minor={line.amountMinor} currency={line.currency} />{' '}
                  {currencyName(line.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="voucher-people">
        {voucher.entry === null ? null : (
          <span>
            {p.entry}: <bdi className="code">{number(voucher.entry)}</bdi>
          </span>
        )}
        {voucher.preparedBy === null ? null : (
          <span>
            {p.preparedBy}: <bdi>{voucher.preparedBy}</bdi>
          </span>
        )}
        {voucher.approvedBy === null ? null : (
          <span>
            {p.approvedBy}: <bdi>{voucher.approvedBy}</bdi>
          </span>
        )}
      </div>
      <footer className="voucher-signatures">
        {[
          p.signatures.receiver,
          p.signatures.cashier,
          p.signatures.accountant,
          p.signatures.manager,
        ].map((label) => (
          <div key={label} className="voucher-signature">
            <span>{label}</span>
          </div>
        ))}
      </footer>
    </main>
  );
}

/** The voucher's page: A5 portrait, ink on white, logical properties only. */
export function voucherStyles(): string {
  const ink = lightColors.foreground;
  const muted = lightColors.mutedForeground;
  const rule = lightColors.border;
  const band = lightColors.muted;
  const negative = lightColors.negative;
  const brand = palette.green[800];
  const fonts = fontFamily.map((family) => (family.includes(' ') ? `"${family}"` : family));
  return `
@page { size: A5 portrait; margin: 10mm 9mm; }
* { box-sizing: border-box; }
html { direction: rtl; }
body { margin: 0; color: ${ink}; background: ${palette.white}; font-family: ${fonts.join(', ')}; font-size: 9pt; line-height: 1.5; font-variant-numeric: tabular-nums; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.voucher-head { border-block-end: 0.6pt solid ${brand}; padding-block-end: 2mm; margin-block-end: 3mm; }
.report-company { font-size: 10pt; font-weight: 700; color: ${brand}; }
.report-title { font-size: 14pt; font-weight: 700; margin-block: 1mm; }
.voucher-facts { display: flex; justify-content: space-between; gap: 4mm; }
.voucher-cancelled { border: 1.2pt solid ${negative}; color: ${negative}; font-size: 14pt; font-weight: 700; text-align: center; padding-block: 1mm; margin-block-end: 3mm; }
table { inline-size: 100%; border-collapse: collapse; }
.voucher-fields th { inline-size: 32mm; text-align: start; font-weight: 700; color: ${muted}; padding: 1mm; vertical-align: top; }
.voucher-fields td { padding: 1mm; border-block-end: 0.3pt solid ${rule}; overflow-wrap: anywhere; }
.voucher-lines { margin-block-start: 4mm; table-layout: fixed; }
.voucher-lines caption { text-align: start; font-weight: 700; margin-block-end: 1mm; }
.voucher-lines th { background: ${band}; border-block-end: 0.6pt solid ${ink}; padding: 1mm; text-align: start; font-weight: 700; }
.voucher-lines td { padding: 1mm; border-block-end: 0.3pt solid ${rule}; vertical-align: top; overflow-wrap: anywhere; }
.voucher-memo { color: ${muted}; font-size: 8pt; }
.num { direction: ltr; unicode-bidi: isolate; text-align: end; white-space: nowrap; }
.code { direction: ltr; unicode-bidi: isolate; }
.neg { color: ${negative}; }
.voucher-people { display: flex; flex-wrap: wrap; gap: 1mm 6mm; margin-block-start: 4mm; color: ${muted}; }
.voucher-signatures { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin-block-start: 14mm; break-inside: avoid; }
.voucher-signature { border-block-start: 0.6pt solid ${ink}; padding-block-start: 1mm; text-align: center; }
`;
}
