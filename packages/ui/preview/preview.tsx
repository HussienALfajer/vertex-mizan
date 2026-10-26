import type { AmountTextError, CurrencyCode, Ledger } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import type { DensityPreference } from '@vertex-mizan/tokens';
import { CheckIcon, DownloadIcon, SearchIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
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
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Kbd,
  type KeymapAction,
  keymap,
  LedgerSwitch,
  PageHeader,
  PeriodBadge,
  PoweredBy,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ThemeToggle,
  ToggleGroup,
  ToggleGroupItem,
  useDensity,
  VertexMizanMark,
} from '../src/index';

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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
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

export function Preview() {
  const { preference, setDensity } = useDensity();
  return (
    <main className="mx-auto flex max-w-6xl min-w-0 flex-col gap-8 px-4 py-6 sm:px-6">
      <div className="relative flex flex-col gap-4">
        <VertexMizanMark label={common.productName} className="w-10 text-primary" />
        <AscentLines className="pointer-events-none absolute inset-y-0 end-0 h-full w-40 text-accent opacity-40" />
        <PageHeader
          title={t.title}
          description={t.subtitle}
          actions={
            <>
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
              <ThemeToggle labels={common.theme} />
            </>
          }
        />
      </div>

      <Section title={t.densities}>
        <div className="grid gap-4">
          <DensitySample density="compact" />
          <DensitySample density="comfortable" />
        </div>
      </Section>

      <Section title={t.entry.title}>
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

      <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title={t.report.title}>
          <TrialBalance />
        </Section>
        <Section title={t.amounts.title}>
          <AmountGallery />
        </Section>
      </div>

      <Section title={t.input.title}>
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

      <Section title={t.states.title}>
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

      <Section title={ar.shortcuts.title}>
        <Shortcuts />
      </Section>

      <footer className="border-t border-border pt-4">
        <PoweredBy label={common.poweredBy} />
      </footer>
    </main>
  );
}
