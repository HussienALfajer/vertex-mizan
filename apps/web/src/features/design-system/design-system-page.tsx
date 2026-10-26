import {
  type AmountTextError,
  type CurrencyCode,
  type Ledger,
  money,
  summarizeAmounts,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import type { DensityPreference } from '@vertex-mizan/tokens';
import {
  AccountLabel,
  Amount,
  AmountInput,
  AscentLines,
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  type CellEdit,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Grid,
  type GridColumnDef,
  type GridProblem,
  Input,
  Kbd,
  type KeymapAction,
  keymap,
  LedgerSwitch,
  PageHeader,
  PeriodBadge,
  PoweredBy,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
  useDensity,
  VertexMizanLogo,
} from '@vertex-mizan/ui';
import { CheckIcon, DownloadIcon, SearchIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';

const t = ar.designSystem;
const { accounting, common } = ar;

/** Synthetic lines of one balanced entry, in SYP minor units (AGENTS.md: no real data). */
const entryLines = [
  { line: 1, code: '1110.02', name: t.accounts.bank, debit: 125_000_000n, credit: null },
  { line: 2, code: '1210', name: t.accounts.receivables, debit: null, credit: 125_000_000n },
  { line: 3, code: '5110.01', name: t.accounts.fees, debit: 1_250_050n, credit: null },
  { line: 4, code: '1110.02', name: t.accounts.bank, debit: null, credit: 1_250_050n },
] as const;
const entryTotal = 126_250_050n;

/** A synthetic trial balance in both ledgers; the parallel figures at a made-up rate. */
const balances = {
  book: {
    currency: 'SYP',
    rows: [375_000_000n, 125_000_000n, -1_500_025n],
    subtotal: 498_499_975n,
    liabilities: -210_000_075n,
    total: 288_499_900n,
  },
  parallel: {
    currency: 'USD',
    rows: [3_000_000n, 1_000_000n, -12_000n],
    subtotal: 3_988_000n,
    liabilities: -1_680_001n,
    total: 2_307_999n,
  },
} as const satisfies Record<Ledger, unknown>;

const ledgers = {
  book: { label: accounting.ledger.book, currency: 'SYP' },
  parallel: { label: accounting.ledger.parallel, currency: 'USD' },
} as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex min-w-0 scroll-mt-4 flex-col gap-3">
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function EntryTable() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">{t.entry.line}</TableHead>
          <TableHead>{t.entry.account}</TableHead>
          <TableHead>{t.entry.description}</TableHead>
          <TableHead numeric>{accounting.debit}</TableHead>
          <TableHead numeric>{accounting.credit}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entryLines.map((line, i) => (
          <TableRow key={line.line} aria-selected={line.line === 3 || undefined}>
            <TableCell className="text-muted-foreground">{line.line}</TableCell>
            <TableCell className="max-w-64">
              <AccountLabel code={line.code} name={line.name} />
            </TableCell>
            <TableCell className="text-muted-foreground">{t.entry.descriptions[i]}</TableCell>
            <TableCell numeric>
              {line.debit !== null && <Amount value={line.debit} currency="SYP" />}
            </TableCell>
            <TableCell numeric>
              {line.credit !== null && <Amount value={line.credit} currency="SYP" />}
            </TableCell>
          </TableRow>
        ))}
        <TableRow className="border-t-2 border-foreground hover:bg-transparent">
          <TableCell />
          <TableCell className="font-bold">{t.entry.total}</TableCell>
          <TableCell>
            <Badge tone="success">
              <CheckIcon aria-hidden="true" />
              {t.entry.balanced}
            </Badge>
          </TableCell>
          <TableCell numeric>
            <Amount value={entryTotal} currency="SYP" strong />
          </TableCell>
          <TableCell numeric>
            <Amount value={entryTotal} currency="SYP" strong />
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

/** Synthetic lines for the data grid: a transaction amount in its own currency, both ledgers. */
interface GridLine {
  readonly id: string;
  readonly account: string;
  readonly currency: CurrencyCode;
  readonly amount: bigint | null;
  readonly book: bigint | null;
  readonly parallel: bigint | null;
  readonly posted?: boolean;
}

/** One balanced entry: the bank side of the SYP line is posted, so it is locked. */
const gridLines: GridLine[] = [
  {
    id: '1',
    account: `1110.02 ${t.accounts.bank}`,
    currency: 'USD',
    amount: 1_000_000n,
    book: 130_000_000n,
    parallel: 1_000_000n,
  },
  {
    id: '2',
    account: `1210 ${t.accounts.receivables}`,
    currency: 'USD',
    amount: -1_000_000n,
    book: -130_000_000n,
    parallel: -1_000_000n,
  },
  {
    id: '3',
    account: `5110.01 ${t.accounts.fees}`,
    currency: 'SYP',
    amount: 1_250_050n,
    book: 1_250_050n,
    parallel: 9_616n,
  },
  {
    id: '4',
    account: `1110.02 ${t.accounts.bank}`,
    currency: 'SYP',
    amount: -1_250_050n,
    book: -1_250_050n,
    parallel: -9_616n,
    posted: true,
  },
];

/** The text of a grid refusal, from i18n (an app writes the same). */
function gridProblemText(problem: GridProblem): string {
  if (problem.problem !== 'INVALID_CELLS') return ar.grid.problems[problem.problem];
  const first = problem.cells[0];
  if (!first) return ar.grid.problems.nothingChanged;
  const reason =
    first.reason === 'AMOUNT'
      ? accounting.amountInput[first.error]
      : first.reason === 'TEXT'
        ? first.error
        : ar.grid.problems[first.reason];
  return `${ar.grid.problems.nothingChanged} ${reason}`;
}

/** A ledger column's total, through the money module. */
function ledgerTotal(
  lines: readonly GridLine[],
  pick: (line: GridLine) => bigint | null,
  currency: CurrencyCode,
) {
  const amounts = lines.flatMap((line) => {
    const value = pick(line);
    return value === null ? [] : [money(value, currency)];
  });
  const [summary] = summarizeAmounts(amounts);
  return <Amount value={summary?.sumMinor ?? 0n} currency={currency} strong />;
}

function DataGridSample() {
  const [lines, setLines] = useState(gridLines);
  const locked = (line: GridLine) => Boolean(line.posted);
  const columns: GridColumnDef<GridLine>[] = [
    {
      id: 'account',
      type: 'text',
      header: t.grid.account,
      value: (line) => line.account,
      readOnly: locked,
      footer: t.grid.total,
    },
    {
      id: 'currency',
      type: 'text',
      header: t.grid.currency,
      value: (line) => line.currency,
      readOnly: true,
      render: (line) => <bdi dir="ltr">{line.currency}</bdi>,
    },
    {
      id: 'amount',
      type: 'amount',
      kind: 'transaction',
      header: t.grid.transaction,
      valueMinor: (line) => line.amount,
      currency: (line) => line.currency,
      readOnly: locked,
    },
    {
      id: 'book',
      type: 'amount',
      kind: 'book',
      header: `${t.grid.book} (SYP)`,
      valueMinor: (line) => line.book,
      currency: () => 'SYP',
      readOnly: true,
      footer: ledgerTotal(lines, (line) => line.book, 'SYP'),
    },
    {
      id: 'parallel',
      type: 'amount',
      kind: 'parallel',
      header: `${t.grid.parallel} (USD)`,
      valueMinor: (line) => line.parallel,
      currency: () => 'USD',
      readOnly: true,
      footer: ledgerTotal(lines, (line) => line.parallel, 'USD'),
    },
  ];
  const apply = (edits: readonly CellEdit[]) =>
    setLines((current) => {
      const next = current.map((line) => ({ ...line }));
      for (const edit of edits) {
        const line = next[edit.row] as { -readonly [K in keyof GridLine]: GridLine[K] };
        if (edit.type === 'text') line.account = edit.text;
        else line.amount = edit.amountMinor;
      }
      return next;
    });
  return (
    <Grid
      aria-label={t.grid.label}
      rows={lines}
      columns={columns}
      rowKey={(line) => line.id}
      onEdit={apply}
      // The preview saves nothing; an app blocks saving and posting while this reports a refusal.
      onEditError={() => {}}
      describeProblem={gridProblemText}
      summaryLabels={ar.grid.summary}
      stickyStartColumn
      className="max-h-80"
    />
  );
}

function DensitySample({ density }: { density: 'compact' | 'comfortable' }) {
  return (
    <Card data-density={density} className="min-w-0 text-control">
      <CardHeader>
        <CardTitle>{common.density[density]}</CardTitle>
      </CardHeader>
      <div className="flex flex-wrap items-center gap-2 px-6">
        <Button>{t.controls.primary}</Button>
        <Button variant="secondary">{t.controls.secondary}</Button>
        <Button variant="outline">
          <DownloadIcon aria-hidden="true" />
          {t.controls.outline}
        </Button>
        <PeriodBadge state="open" label={accounting.period.open} />
      </div>
      <div className="flex flex-col gap-3 p-6">
        <Input aria-label={t.controls.search} placeholder={t.controls.search} />
        <EntryTable />
      </div>
    </Card>
  );
}

function TrialBalance() {
  const [ledger, setLedger] = useState<Ledger>('book');
  const data = balances[ledger];
  const currency: CurrencyCode = data.currency;
  const names = [t.accounts.bank, t.accounts.receivables, t.accounts.oldCash];
  const codes = ['1110.02', '1210', '1190'];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <LedgerSwitch
        label={accounting.ledger.label}
        value={ledger}
        onValueChange={setLedger}
        ledgers={ledgers}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.entry.account}</TableHead>
            <TableHead numeric>
              {t.report.balance} <bdi dir="ltr">({currency})</bdi>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={2}>
              <AccountLabel
                code="1000"
                name={t.report.assets}
                kind="header"
                kindLabel={accounting.account.header}
              />
            </TableCell>
          </TableRow>
          {data.rows.map((value, i) => (
            <TableRow key={codes[i]}>
              <TableCell className="ps-8">
                <AccountLabel
                  code={codes[i] ?? ''}
                  name={names[i] ?? ''}
                  {...(i === 2
                    ? { kind: 'blocked' as const, kindLabel: accounting.account.blocked }
                    : {})}
                />
              </TableCell>
              <TableCell numeric>
                <Amount value={value} currency={currency} />
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="hover:bg-transparent">
            <TableCell className="ps-8 font-bold">{t.report.subtotal}</TableCell>
            <TableCell numeric>
              <span className="inline-block border-t border-foreground pt-0.5">
                <Amount value={data.subtotal} currency={currency} strong />
              </span>
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>
              <AccountLabel
                code="2000"
                name={t.report.liabilities}
                kind="header"
                kindLabel={accounting.account.header}
              />
            </TableCell>
            <TableCell numeric>
              <Amount value={data.liabilities} currency={currency} />
            </TableCell>
          </TableRow>
          <TableRow className="hover:bg-transparent">
            <TableCell className="font-bold">{t.report.grandTotal}</TableCell>
            <TableCell numeric>
              <span className="inline-block border-b-[3px] border-double border-foreground">
                <Amount value={data.total} currency={currency} strong />
              </span>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function AmountGallery() {
  const rows: [string, ReactNode][] = [
    [t.amounts.negative, <Amount key="n" value={-125_000_050n} currency="SYP" />],
    [t.amounts.zero, <Amount key="z" value={0n} currency="SYP" />],
    [t.amounts.zeroDash, <Amount key="d" value={0n} currency="SYP" zero="dash" />],
    [t.amounts.withCode, <Amount key="c" value={-1_250_000n} currency="USD" showCurrency />],
    [t.amounts.largest, <Amount key="l" value={9_223_372_036_854_775_807n} currency="SYP" />],
  ];
  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableBody>
          {rows.map(([label, amount]) => (
            <TableRow key={label}>
              <TableCell>{label}</TableCell>
              <TableCell numeric>{amount}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="whitespace-normal">{t.amounts.strong}</TableCell>
            <TableCell numeric>
              <div className="flex flex-col">
                <Amount value={1_111_111_111_11n} currency="SYP" />
                <Amount value={1_111_111_111_11n} currency="SYP" strong />
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <p className="text-control">
        <span className="text-muted-foreground">{t.amounts.inSentence}: </span>
        {t.amounts.sentenceBefore} <Amount value={-1_250_000n} currency="SYP" showCurrency />{' '}
        {t.amounts.sentenceAfter}
      </p>
    </div>
  );
}

function AmountField({ label, allowNegative }: { label: string; allowNegative: boolean }) {
  const [value, setValue] = useState<bigint | null>(allowNegative ? -1_250_050n : null);
  const [error, setError] = useState<AmountTextError | null>(null);
  return (
    <Field invalid={error !== null} className="min-w-0 flex-1">
      <FieldLabel>{label}</FieldLabel>
      <AmountInput
        currency="SYP"
        value={value}
        onValueChange={setValue}
        onTextError={setError}
        allowNegative={allowNegative}
      />
      <FieldDescription>
        {t.input.stored}: <bdi dir="ltr">{value === null ? '—' : value.toString()}</bdi>
      </FieldDescription>
      <FieldError match={error !== null}>{error && accounting.amountInput[error]}</FieldError>
    </Field>
  );
}

const keymapGroups: [string, KeymapAction[]][] = [
  [ar.shortcuts.global, ['commandPalette', 'cheatSheet', 'newEntry']],
  [
    ar.shortcuts.grid,
    [
      'editCell',
      'selectAll',
      'selectRows',
      'selectColumns',
      'fillDown',
      'copyAbove',
      'insertLine',
      'deleteLine',
      'lookup',
      'post',
    ],
  ],
  [ar.shortcuts.date, ['today']],
];

function Shortcuts() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {keymapGroups.map(([group, actions]) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle>{group}</CardTitle>
          </CardHeader>
          <ul className="flex flex-col gap-2 px-6 pb-6">
            {actions.map((action) => (
              <li key={action} className="flex items-center justify-between gap-3">
                <span>{ar.shortcuts.actions[action]}</span>
                <Kbd shortcut={keymap[action]} />
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

/**
 * The design system's page (`/design-system`): every component of `packages/ui` with synthetic
 * data, in the shell (the sidebar and command palette are the shell's own). The screenshot tests photograph it in both themes at 360, 768 and 1280 px.
 */
export function DesignSystemPage() {
  const { preference, setDensity } = useDensity();
  return (
    <>
      <PageHeader
        title={t.title}
        description={t.subtitle}
        actions={
          <ToggleGroup<DensityPreference>
            aria-label={common.density.label}
            value={[preference]}
            onValueChange={([next]) => next && setDensity(next)}
          >
            {(['auto', 'compact', 'comfortable'] as const).map((option) => (
              <ToggleGroupItem key={option} value={option}>
                {common.density[option]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />

      <Section id="densities" title={t.densities}>
        <div className="grid gap-4">
          <DensitySample density="compact" />
          <DensitySample density="comfortable" />
        </div>
      </Section>

      <Section id="entry" title={t.entry.title}>
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-3">
              {t.entry.number} <bdi dir="ltr">JV-2026-000123</bdi>
              <PeriodBadge state="open" label={accounting.period.open} />
            </CardTitle>
            <CardDescription>
              {t.entry.date}: <bdi dir="ltr">2026-10-21</bdi>
            </CardDescription>
          </CardHeader>
          <div className="px-6 pb-6">
            <EntryTable />
          </div>
        </Card>
      </Section>

      <Section id="grid" title={t.grid.title}>
        <p className="text-muted-foreground">{t.grid.hint}</p>
        <DataGridSample />
      </Section>

      <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
        <Section id="report" title={t.report.title}>
          <TrialBalance />
        </Section>
        <Section id="amounts" title={t.amounts.title}>
          <AmountGallery />
        </Section>
      </div>

      <Section id="input" title={t.input.title}>
        <Card>
          <CardHeader>
            <CardDescription>{t.input.hint}</CardDescription>
          </CardHeader>
          <div className="flex flex-col gap-4 px-6 pb-6 sm:flex-row">
            <AmountField label={t.input.free} allowNegative />
            <AmountField label={t.input.debit} allowNegative={false} />
          </div>
        </Card>
      </Section>

      <Section id="states" title={t.states.title}>
        <div className="flex flex-wrap items-center gap-3">
          <PeriodBadge state="open" label={accounting.period.open} />
          <PeriodBadge state="closed" label={accounting.period.closed} />
          <PeriodBadge state="reopened" label={accounting.period.reopened} />
          <Button variant="ghost" size="sm">
            <SearchIcon aria-hidden="true" />
            {t.controls.search}
          </Button>
        </div>
      </Section>

      <Section id="sheet" title={t.sheet.title}>
        <p className="text-muted-foreground">{t.sheet.hint}</p>
        <Sheet>
          <SheetTrigger render={<Button variant="outline" className="w-fit" />}>
            {t.sheet.open}
          </SheetTrigger>
          <SheetContent className="gap-3 p-6">
            <SheetTitle>{t.sheet.heading}</SheetTitle>
            <AccountLabel code="1110.02" name={t.accounts.bank} />
            <p className="text-muted-foreground">{t.sheet.body}</p>
            <SheetClose render={<Button variant="secondary" className="w-fit" />}>
              {common.close}
            </SheetClose>
          </SheetContent>
        </Sheet>
      </Section>

      <Section id="brand" title={t.brand.title}>
        <p className="text-muted-foreground">{t.brand.hint}</p>
        <Card className="flex-row items-center justify-between gap-4 overflow-hidden">
          <VertexMizanLogo
            label={common.productName}
            className="h-20 w-auto min-w-0 text-primary"
          />
          <AscentLines className="h-16 w-40 shrink-0 text-accent" />
        </Card>
        <PoweredBy label={common.poweredBy} />
      </Section>

      <Section id="shortcuts" title={ar.shortcuts.title}>
        <Shortcuts />
      </Section>
    </>
  );
}
