import { type CurrencyCode, formatMinor, type ProjectMovementKind } from '@vertex-mizan/contracts';
import type { Catalog } from '@vertex-mizan/i18n';
import { fontFamily, lightColors, palette } from '@vertex-mizan/tokens';
import type { ReactNode } from 'react';

/**
 * S13's three PDFs ("Printing", ADR 0024 §8): A4, Arabic, right to left, under the company's
 * display name and logo, with no mark of the product. Every page carries the logo, the name, the
 * report's title and scope and the print time in the printer's page header
 * (`movementsPageHeader()`), and its number in the footer. Amounts print with their currency (SYP
 * as "الليرة السورية الجديدة"), totals in the book currency (USD), every figure as `packages/db`
 * read it from the ledger: no arithmetic happens here. Text arrives as props.
 */

/** An amount in a currency with its book amount, as integer strings. */
export interface PrintCurrencyAmount {
  readonly currency: CurrencyCode;
  readonly amountMinor: string;
  readonly bookMinor: string;
}

/** A movement as `packages/db`'s `readMovements()` reads it. */
export interface PrintMovement {
  readonly kind: ProjectMovementKind;
  readonly fiscalYear: number;
  readonly number: number;
  readonly date: string;
  readonly project: { readonly name: string } | null;
  readonly party: { readonly name: string } | null;
  readonly currency: CurrencyCode;
  readonly amountMinor: string;
  readonly bookMinor: string;
  readonly description: string;
  readonly material: {
    readonly name: string;
    readonly unit: string;
    readonly quantity: string;
    readonly unitPrice: string;
  } | null;
  readonly cancellation: { readonly reason: string; readonly on: string } | null;
}

/** A material's cost as `readMaterialCosts()` reads it. */
export interface PrintMaterialCost {
  readonly material: { readonly name: string; readonly unit: string };
  readonly quantity: string;
  readonly bookMinor: string;
  readonly byCurrency: readonly PrintCurrencyAmount[];
  readonly byProject: readonly {
    readonly project: { readonly name: string };
    readonly quantity: string;
    readonly bookMinor: string;
  }[];
}

/** A project's or the company's figures as `readFigures()` reads them. */
export interface PrintFigures {
  readonly revenueMinor: string;
  readonly costsMinor: string;
  readonly profitMinor: string;
  readonly receivedMinor: string;
  readonly expensesMinor: string;
  readonly wagesMinor: string;
  readonly netCashMinor: string;
  readonly owedByUs: readonly PrintCurrencyAmount[];
  readonly owedToUs: readonly PrintCurrencyAmount[];
  readonly movementCount: number;
}

/** One project's section, as `readProjectStatementPrint()` reads it. */
export interface PrintProjectSection {
  readonly project: {
    readonly name: string;
    readonly client: { readonly name: string };
    readonly startDate: string;
    readonly state: 'active' | 'finished';
    readonly contractValue: {
      readonly amountMinor: string;
      readonly currency: CurrencyCode;
    } | null;
    readonly figures: PrintFigures;
  };
  readonly movements: readonly PrintMovement[];
  readonly materials: readonly PrintMaterialCost[];
  readonly materialsBookMinor: string;
  readonly suppliers: readonly {
    readonly supplier: { readonly name: string };
    readonly owed: readonly PrintCurrencyAmount[];
  }[];
}

/** A client or supplier with what is owed each way, as `readParties()` reads it. */
export interface PrintParty {
  readonly name: string;
  readonly owedToUs: readonly PrintCurrencyAmount[];
  readonly owedByUs: readonly PrintCurrencyAmount[];
}

/** The PDF of all projects, as `readProjectsOverviewPrint()` reads it. */
export interface PrintProjectsOverview {
  readonly figures: PrintFigures;
  readonly exchangeDifferencesMinor: string;
  readonly boxes: readonly PrintCurrencyAmount[];
  readonly projects: readonly PrintProjectSection[];
  readonly materials: readonly PrintMaterialCost[];
  readonly materialsBookMinor: string;
  readonly clients: readonly PrintParty[];
  readonly suppliers: readonly PrintParty[];
  readonly rates: readonly {
    readonly date: string;
    readonly base: CurrencyCode;
    readonly quote: CurrencyCode;
    readonly rate: string;
  }[];
}

export type MovementsPrintData =
  | { readonly report: 'projects_overview'; readonly data: PrintProjectsOverview }
  | { readonly report: 'project_statement'; readonly data: PrintProjectSection }
  | {
      readonly report: 'material_costs';
      readonly data: {
        readonly materials: readonly PrintMaterialCost[];
        readonly totalBookMinor: string;
      };
    };

export interface MovementsPrintText {
  readonly print: Catalog['movements']['print'];
  readonly kinds: Catalog['movements']['kinds'];
  readonly states: Catalog['movements']['states'];
  readonly figures: Catalog['movements']['figures'];
}

export interface MovementsPrintProps {
  /** The company's display name. */
  readonly company: string;
  /** The logo as a `data:` URL, or none. */
  readonly logo: string | null;
  readonly title: string;
  /** What the report covers: "حتى <date>", or the materials' range and project. */
  readonly scope: string;
  readonly printedAt: string;
  readonly bookCurrency: CurrencyCode;
  /** A currency's printed name: "الليرة السورية الجديدة" for SYP. */
  readonly currencyName: (currency: CurrencyCode) => string;
  readonly text: MovementsPrintText;
  readonly content: MovementsPrintData;
}

interface Context {
  readonly book: CurrencyCode;
  readonly currencyName: (currency: CurrencyCode) => string;
  readonly text: MovementsPrintText;
}

/** The printed body of one of the three PDFs. */
export function MovementsPrint(props: MovementsPrintProps) {
  const context: Context = {
    book: props.bookCurrency,
    currencyName: props.currencyName,
    text: props.text,
  };
  const { content } = props;
  return (
    <main data-slot="movements-print" data-report={content.report}>
      {content.report === 'projects_overview' ? (
        <>
          <Cover {...props} />
          <Overview data={content.data} context={context} />
        </>
      ) : null}
      {content.report === 'project_statement' ? (
        <ProjectSection section={content.data} context={context} first />
      ) : null}
      {content.report === 'material_costs' ? (
        <section>
          <MaterialsTable
            materials={content.data.materials}
            total={content.data.totalBookMinor}
            context={context}
            byProject
          />
        </section>
      ) : null}
    </main>
  );
}

function Cover({ company, logo, title, scope, printedAt, text }: MovementsPrintProps) {
  return (
    <section className="cover">
      {logo === null ? null : <img className="cover-logo" src={logo} alt="" />}
      <div className="cover-company">
        <bdi>{company}</bdi>
      </div>
      <h1 className="cover-title">{title}</h1>
      <div className="cover-scope">{scope}</div>
      <div className="cover-printed">{text.print.printedAt.replace('{time}', printedAt)}</div>
    </section>
  );
}

function Overview({ data, context }: { data: PrintProjectsOverview; context: Context }) {
  const t = context.text.print;
  return (
    <>
      <section className="block">
        <h2>{t.summary}</h2>
        <FiguresTable
          figures={data.figures}
          context={context}
          extra={[
            [t.projectsCount, String(data.projects.length)],
            [
              context.text.figures.exchangeDifferences,
              money(data.exchangeDifferencesMinor, context.book),
            ],
          ]}
        />
        <h3>{t.boxes}</h3>
        <CurrencyTable amounts={data.boxes} context={context} empty={t.noDebts} />
        <h3>{t.projects}</h3>
        {data.projects.length === 0 ? (
          <p className="empty">{t.noProjects}</p>
        ) : (
          <Table
            head={[t.columns.project, t.client, t.state, t.columns.netCash, t.columns.profit]}
            numeric={[3, 4]}
            rows={data.projects.map(({ project }) => [
              <bdi key="p">{project.name}</bdi>,
              <bdi key="c">{project.client.name}</bdi>,
              context.text.states[project.state],
              money(project.figures.netCashMinor, context.book),
              money(project.figures.profitMinor, context.book),
            ])}
          />
        )}
        <p className="note">{t.totalsNote}</p>
      </section>
      {keyed(data.projects).map(({ key, item: section }) => (
        <ProjectSection key={key} section={section} context={context} first={false} />
      ))}
      <section className="block page">
        <h2>{t.materialsAcross}</h2>
        <MaterialsTable
          materials={data.materials}
          total={data.materialsBookMinor}
          context={context}
          byProject
        />
      </section>
      <section className="block">
        <h2>{t.debtsByParty}</h2>
        <h3>{t.clients}</h3>
        <PartyTable parties={data.clients} side="owedToUs" context={context} />
        <h3>{t.suppliers}</h3>
        <PartyTable parties={data.suppliers} side="owedByUs" context={context} />
      </section>
      <section className="block">
        <h2>{t.rates}</h2>
        {data.rates.length === 0 ? (
          <p className="empty">{t.noRates}</p>
        ) : (
          <>
            <p className="note">{t.ratesNote}</p>
            <Table
              head={[t.columns.date, t.columns.currency, t.columns.rate]}
              numeric={[2]}
              rows={data.rates.map((rate) => [
                <span key="d" className="code">
                  {rate.date}
                </span>,
                `1 ${context.currencyName(rate.base)} = ${context.currencyName(rate.quote)}`,
                rate.rate,
              ])}
            />
          </>
        )}
      </section>
    </>
  );
}

function ProjectSection({
  section,
  context,
  first,
}: {
  section: PrintProjectSection;
  context: Context;
  first: boolean;
}) {
  const t = context.text.print;
  const { project } = section;
  return (
    <section className={first ? 'block' : 'block page'}>
      <h2>
        <bdi>{project.name}</bdi>
      </h2>
      <div className="facts">
        <span>
          {t.client}:{' '}
          <b>
            <bdi>{project.client.name}</bdi>
          </b>
        </span>
        <span>
          {t.started}: <b className="code">{project.startDate}</b>
        </span>
        <span>
          {t.state}: <b>{context.text.states[project.state]}</b>
        </span>
        {project.contractValue === null ? null : (
          <span>
            {t.contractValue}:{' '}
            <b>
              {money(project.contractValue.amountMinor, project.contractValue.currency, context)}
            </b>
          </span>
        )}
      </div>
      <h3>{t.summary}</h3>
      <FiguresTable figures={project.figures} context={context} extra={[]} />
      <h3>{t.movements}</h3>
      <MovementsTable movements={section.movements} context={context} />
      <h3>{t.materials}</h3>
      <MaterialsTable
        materials={section.materials}
        total={section.materialsBookMinor}
        context={context}
        byProject={false}
      />
      <h3>{t.debts}</h3>
      {project.figures.owedToUs.length === 0 && section.suppliers.length === 0 ? (
        <p className="empty">{t.noDebts}</p>
      ) : (
        <Table
          head={[t.columns.name, t.columns.amount, t.columns.currency, t.columns.book]}
          numeric={[1, 3]}
          rows={[
            ...project.figures.owedToUs.map((owed) => [
              <span key="n">
                {context.text.figures.owedToUs}: <bdi>{project.client.name}</bdi>
              </span>,
              ...amountCells(owed, context),
            ]),
            ...section.suppliers.flatMap(({ supplier, owed }) =>
              owed.map((item) => [
                <span key="n">
                  {context.text.figures.owedByUs}: <bdi>{supplier.name}</bdi>
                </span>,
                ...amountCells(item, context),
              ]),
            ),
          ]}
        />
      )}
    </section>
  );
}

function FiguresTable({
  figures,
  context,
  extra,
}: {
  figures: PrintFigures;
  context: Context;
  extra: readonly (readonly [string, ReactNode])[];
}) {
  const f = context.text.figures;
  const book = (value: string) => money(value, context.book);
  const owed = (label: string, amounts: readonly PrintCurrencyAmount[]) =>
    amounts.length === 0
      ? [[label, book('0')] as const]
      : amounts.map(
          (item) =>
            [
              `${label} (${context.currencyName(item.currency)})`,
              <>
                {money(item.bookMinor, context.book)}
                <span className="beside">{money(item.amountMinor, item.currency, context)}</span>
              </>,
            ] as const,
        );
  const rows: (readonly [string, ReactNode])[] = [
    ...extra,
    [f.received, book(figures.receivedMinor)],
    [f.revenue, book(figures.revenueMinor)],
    [f.expenses, book(figures.expensesMinor)],
    [f.wages, book(figures.wagesMinor)],
    [f.costs, book(figures.costsMinor)],
    [f.profit, book(figures.profitMinor)],
    [f.netCash, book(figures.netCashMinor)],
    ...owed(f.owedToUs, figures.owedToUs),
    ...owed(f.owedByUs, figures.owedByUs),
    [f.movementCount, String(figures.movementCount)],
  ];
  return (
    <table className="figures">
      <tbody>
        {keyed(rows).map(({ key, item: [label, value] }) => (
          <tr key={key} className={label === f.profit ? 'total' : undefined}>
            <th>{label}</th>
            <td className="num">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MovementsTable({
  movements,
  context,
}: {
  movements: readonly PrintMovement[];
  context: Context;
}) {
  const t = context.text.print;
  if (movements.length === 0) return <p className="empty">{t.noMovements}</p>;
  return (
    <Table
      className="movements"
      head={[
        t.columns.number,
        t.columns.date,
        t.columns.kind,
        t.columns.party,
        t.columns.description,
        t.columns.amount,
        t.columns.currency,
        t.columns.book,
      ]}
      numeric={[5, 7]}
      rows={movements.map((movement) => ({
        className: movement.cancellation === null ? undefined : 'cancelled',
        cells: [
          <span key="n" className="code">
            {movement.fiscalYear}/{movement.number}
          </span>,
          <span key="d" className="code">
            {movement.date}
          </span>,
          context.text.kinds[movement.kind],
          movement.party === null ? '' : <bdi key="p">{movement.party.name}</bdi>,
          <span key="x">
            <bdi>{movement.description}</bdi>
            {movement.material === null ? null : (
              <span className="detail">
                <bdi>{movement.material.name}</bdi>:{' '}
                <span className="code">{movement.material.quantity}</span>{' '}
                <bdi>{movement.material.unit}</bdi> ×{' '}
                <span className="code">{movement.material.unitPrice}</span>
              </span>
            )}
            {movement.cancellation === null ? null : (
              <span className="detail cancel">
                {t.cancelled
                  .replace('{date}', movement.cancellation.on)
                  .replace('{reason}', movement.cancellation.reason)}
              </span>
            )}
          </span>,
          ...amountCells(movement, context),
        ],
      }))}
    />
  );
}

function MaterialsTable({
  materials,
  total,
  context,
  byProject,
}: {
  materials: readonly PrintMaterialCost[];
  total: string;
  context: Context;
  byProject: boolean;
}) {
  const t = context.text.print;
  if (materials.length === 0) return <p className="empty">{t.noMaterials}</p>;
  const rows: Row[] = [];
  for (const material of materials) {
    rows.push({
      className: byProject ? 'group' : undefined,
      cells: [
        <bdi key="m">{material.material.name}</bdi>,
        <bdi key="u">{material.material.unit}</bdi>,
        material.quantity,
        <span key="c">
          {material.byCurrency.map((item) => (
            <span key={item.currency} className="line">
              {money(item.amountMinor, item.currency, context)}
            </span>
          ))}
        </span>,
        money(material.bookMinor, context.book),
      ],
    });
    if (byProject) {
      for (const share of material.byProject) {
        rows.push({
          className: 'share',
          cells: [
            <span key="p" className="indent">
              <bdi>{share.project.name}</bdi>
            </span>,
            '',
            share.quantity,
            '',
            money(share.bookMinor, context.book),
          ],
        });
      }
    }
  }
  rows.push({
    className: 'total',
    cells: [t.total, '', '', '', money(total, context.book)],
  });
  return (
    <Table
      head={[
        byProject ? `${t.columns.material} / ${t.columns.project}` : t.columns.material,
        t.columns.unit,
        t.columns.quantity,
        t.columns.amount,
        t.columns.book,
      ]}
      numeric={[2, 3, 4]}
      rows={rows}
    />
  );
}

function PartyTable({
  parties,
  side,
  context,
}: {
  parties: readonly PrintParty[];
  side: 'owedToUs' | 'owedByUs';
  context: Context;
}) {
  const t = context.text.print;
  const rows = parties.flatMap((party) =>
    party[side].map((owed) => [<bdi key="n">{party.name}</bdi>, ...amountCells(owed, context)]),
  );
  if (rows.length === 0) return <p className="empty">{t.noDebts}</p>;
  return (
    <Table
      head={[t.columns.name, t.columns.amount, t.columns.currency, t.columns.book]}
      numeric={[1, 3]}
      rows={rows}
    />
  );
}

function CurrencyTable({
  amounts,
  context,
  empty,
}: {
  amounts: readonly PrintCurrencyAmount[];
  context: Context;
  empty: string;
}) {
  const t = context.text.print;
  if (amounts.length === 0) return <p className="empty">{empty}</p>;
  return (
    <Table
      head={[t.columns.amount, t.columns.currency, t.columns.book]}
      numeric={[0, 2]}
      rows={amounts.map((amount) => amountCells(amount, context))}
    />
  );
}

/** Static rows, printed once in their order: each keyed by its position. */
const keyed = <T,>(items: readonly T[]) => items.map((item, at) => ({ key: `row-${at}`, item }));

type Row = { readonly className: string | undefined; readonly cells: readonly ReactNode[] };

function Table({
  head,
  rows,
  numeric,
  className,
}: {
  head: readonly string[];
  rows: readonly (Row | readonly ReactNode[])[];
  numeric: readonly number[];
  className?: string;
}) {
  return (
    <table className={className}>
      <thead>
        <tr>
          {keyed(head).map(({ key, item: label }, at) => (
            <th key={key} className={numeric.includes(at) ? 'num' : undefined}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {keyed(rows).map(({ key, item: row }) => {
          const { cells, className: rowClass } = Array.isArray(row)
            ? { cells: row as readonly ReactNode[], className: undefined }
            : (row as Row);
          return (
            <tr key={key} className={rowClass}>
              {keyed(cells).map(({ key: cellKey, item: cell }, position) => (
                <td key={cellKey} className={numeric.includes(position) ? 'num' : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** An amount's cells: the amount in its currency, the currency's name, the book amount. */
function amountCells(
  amount: { currency: CurrencyCode; amountMinor: string; bookMinor: string },
  context: Context,
): ReactNode[] {
  return [
    money(amount.amountMinor, amount.currency),
    context.currencyName(amount.currency),
    money(amount.bookMinor, context.book),
  ];
}

/** An amount through the money module, LTR, negative in the negative color; with its currency's name when given the context. */
function money(minor: string, currency: CurrencyCode, context?: Context): ReactNode {
  const text = formatMinor(BigInt(minor), currency);
  return (
    <span className={text.startsWith('-') ? 'amount neg' : 'amount'}>
      {text}
      {context === undefined ? null : (
        <span className="unit">{context.currencyName(currency)}</span>
      )}
    </span>
  );
}

const escapeText = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * The page header Chromium prints on every page (S13 "Printing"): the logo, the company's display
 * name, the report's title and scope, and the print time; the logo a `data:` URL of a PNG or JPEG
 * the company uploaded.
 */
export function movementsPageHeader(props: {
  readonly company: string;
  readonly logo: string | null;
  readonly title: string;
  readonly scope: string;
  readonly printedAt: string;
}): string {
  const brand = palette.green[800];
  const muted = lightColors.mutedForeground;
  const logo =
    props.logo === null || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(props.logo)
      ? ''
      : `<img src="${props.logo}" style="max-block-size:12mm;max-inline-size:30mm;object-fit:contain">`;
  // Chromium lays the template over the page's top margin (30 mm): a box of that height, inset
  // as the page's own margins, every size explicit since the template has no stylesheet of ours.
  // The system's sans-serif, as the footer's: a face inlined here never loads in time, and its
  // `font-display: block` would leave the text unpainted.
  return `<div style="box-sizing:border-box;direction:rtl;inline-size:100%;block-size:28mm;padding-block:8mm 0;padding-inline:12mm;font-family:sans-serif;font-size:8pt;line-height:1.4;color:${lightColors.foreground};-webkit-print-color-adjust:exact;print-color-adjust:exact"><div style="display:flex;align-items:center;gap:4mm;padding-block-end:2mm;border-block-end:0.6pt solid ${brand}">${logo}<div style="flex:1;min-inline-size:0"><div style="font-size:10.5pt;font-weight:700;color:${brand}">${escapeText(props.company)}</div><div><b>${escapeText(props.title)}</b> · ${escapeText(props.scope)}</div></div><div style="color:${muted};white-space:nowrap">${escapeText(props.printedAt)}</div></div></div>`;
}

/** The stylesheet of the three PDFs: A4 with room for the page header and footer. */
export function movementsPrintStyles(): string {
  const ink = lightColors.foreground;
  const muted = lightColors.mutedForeground;
  const rule = lightColors.border;
  const band = lightColors.muted;
  const negative = lightColors.negative;
  const brand = palette.green[800];
  const fonts = fontFamily.map((family) => (family.includes(' ') ? `"${family}"` : family));
  return `
@page { size: A4; margin: 30mm 12mm 16mm; }
* { box-sizing: border-box; }
html { direction: rtl; }
body { margin: 0; color: ${ink}; background: ${palette.white}; font-family: ${fonts.join(', ')}; font-size: 8.5pt; line-height: 1.45; font-variant-numeric: tabular-nums; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cover { min-block-size: 200mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4mm; text-align: center; break-after: page; }
.cover-logo { max-block-size: 40mm; max-inline-size: 80mm; object-fit: contain; }
.cover-company { font-size: 20pt; font-weight: 700; color: ${brand}; }
.cover-title { font-size: 16pt; font-weight: 700; margin: 0; }
.cover-scope, .cover-printed { color: ${muted}; font-size: 10pt; }
.block + .block { margin-block-start: 6mm; }
.block.page { break-before: page; margin-block-start: 0; }
h2 { font-size: 13pt; font-weight: 700; color: ${brand}; margin-block: 0 2mm; border-block-end: 0.6pt solid ${brand}; padding-block-end: 1mm; break-after: avoid; }
h3 { font-size: 10pt; font-weight: 700; margin-block: 4mm 1.5mm; break-after: avoid; }
.facts { display: flex; flex-wrap: wrap; gap: 1mm 6mm; color: ${muted}; }
.facts b { color: ${ink}; font-weight: 700; }
.note, .empty { color: ${muted}; margin-block: 1.5mm; }
table { inline-size: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { font-weight: 700; background: ${band}; border-block-end: 0.6pt solid ${ink}; padding: 1mm; text-align: start; vertical-align: bottom; }
td { padding: 0.6mm 1mm; border-block-end: 0.3pt solid ${rule}; vertical-align: top; overflow-wrap: anywhere; }
table.figures { inline-size: 70%; }
table.figures th { background: none; border-block-end: 0.3pt solid ${rule}; font-weight: 400; color: ${muted}; inline-size: 55%; }
.num { text-align: end; white-space: nowrap; }
th.num { text-align: end; }
.amount, .code { direction: ltr; unicode-bidi: isolate; }
.code { white-space: nowrap; }
.unit { margin-inline-start: 1mm; font-size: 7.5pt; color: ${muted}; }
.beside { display: block; font-size: 7.5pt; color: ${muted}; }
.line { display: block; }
.neg { color: ${negative}; }
.detail { display: block; color: ${muted}; font-size: 7.5pt; }
.cancel { color: ${negative}; }
tr.cancelled td { color: ${muted}; }
tr.cancelled .amount { text-decoration: line-through; }
tr.group td { font-weight: 700; }
tr.share td { color: ${muted}; }
.indent { padding-inline-start: 4mm; display: inline-block; }
tr.total td, tr.total th { font-weight: 700; border-block-start: 0.6pt solid ${ink}; }
`;
}
