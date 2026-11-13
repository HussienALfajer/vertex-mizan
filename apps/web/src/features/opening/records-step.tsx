import {
  type Account,
  CURRENCY_CODES,
  type CurrencyCode,
  type DimensionType,
  type DimensionValue,
  debitCreditOf,
  type OpeningLineInput,
  type OpeningViewAnswer,
  signedAmount,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  Button,
  type CellEdit,
  Grid,
  type GridColumnDef,
  type GridHandle,
  type GridProblem,
  gridCellOf,
  Kbd,
  keymap,
  matchesShortcut,
} from '@vertex-mizan/ui';
import { PlusIcon } from 'lucide-react';
import { type KeyboardEvent, useRef } from 'react';
import { findDimensionValue } from '../entries/draft-lines';
import { accountProblem, gridProblemText } from '../entries/entry-editor';
import { fill } from './opening-parts';

const t = ar.opening.records;

/**
 * A line of the old records as typed (S10 rules 14, 17): the amount signed (debit positive); a
 * stated line's book and parallel amounts as magnitudes on the line's side, signed when saved.
 */
export interface RecordRow {
  readonly key: string;
  readonly accountId: string | null;
  readonly dimensionValueIds: readonly string[];
  readonly currency: CurrencyCode | null;
  readonly amountMinor: bigint | null;
  readonly bookMinor: bigint | null;
  readonly parallelMinor: bigint | null;
  readonly itemReference: string;
  readonly itemDueOn: string;
  readonly memo: string;
}

let lastKey = 0;
const newKey = () => {
  lastKey += 1;
  return `record-${lastKey}`;
};

export function emptyRecordRow(): RecordRow {
  return {
    key: newKey(),
    accountId: null,
    dimensionValueIds: [],
    currency: null,
    amountMinor: null,
    bookMinor: null,
    parallelMinor: null,
    itemReference: '',
    itemDueOn: '',
    memo: '',
  };
}

const magnitude = (minor: bigint) => {
  const sides = debitCreditOf(minor);
  return sides.debitMinor ?? sides.creditMinor ?? 0n;
};

/** The saved lines as rows, one empty row when there is none. */
export function recordRowsOf(view: OpeningViewAnswer): RecordRow[] {
  if (view.recordLines.length === 0) return [emptyRecordRow()];
  return view.recordLines.map((line) => ({
    key: newKey(),
    accountId: line.accountId,
    dimensionValueIds: line.dimensionValueIds,
    currency: line.currency,
    amountMinor: BigInt(line.amountMinor),
    bookMinor: line.bookMinor === null ? null : magnitude(BigInt(line.bookMinor)),
    parallelMinor: line.parallelMinor === null ? null : magnitude(BigInt(line.parallelMinor)),
    itemReference: line.itemReference ?? '',
    itemDueOn: line.itemDueOn ?? '',
    memo: line.memo ?? '',
  }));
}

export function isBlankRecord(row: RecordRow): boolean {
  return (
    row.accountId === null &&
    row.dimensionValueIds.length === 0 &&
    row.currency === null &&
    row.amountMinor === null &&
    row.bookMinor === null &&
    row.parallelMinor === null &&
    row.itemReference.trim() === '' &&
    row.itemDueOn.trim() === '' &&
    row.memo.trim() === ''
  );
}

/** Whether a typed row has its account, currency and a non-zero amount (rule 14). */
export function isCompleteRecord(row: RecordRow): boolean {
  return (
    row.accountId !== null &&
    row.currency !== null &&
    row.amountMinor !== null &&
    row.amountMinor !== 0n
  );
}

/** The ledgers' currencies, which decide which stated amounts a line takes (rule 17). */
export interface LedgerCurrencies {
  readonly book: CurrencyCode;
  readonly parallel: CurrencyCode | null;
}

/**
 * The lines `PUT /api/opening` takes: blank rows left out, a stated amount signed on the line's
 * side and only where its ledger's currency is not the line's (there the amount is itself), none
 * on a monetary line (rule 17), an item's reference and due date only on a document account.
 */
export function recordLinesInput(
  rows: readonly RecordRow[],
  accounts: ReadonlyMap<string, Account>,
  ledgers: LedgerCurrencies,
): OpeningLineInput[] {
  return rows
    .filter((row) => !isBlankRecord(row) && isCompleteRecord(row))
    .map((row) => {
      const account = row.accountId ? accounts.get(row.accountId) : undefined;
      const amount = row.amountMinor ?? 0n;
      const side = amount < 0n ? 'credit' : 'debit';
      const stated = (ledgerCurrency: CurrencyCode | null, typed: bigint | null) =>
        account?.isMonetary ||
        ledgerCurrency === null ||
        ledgerCurrency === row.currency ||
        typed === null
          ? null
          : signedAmount(side, typed).toString();
      const document = account?.itemKind === 'document' && row.itemReference.trim() !== '';
      return {
        accountId: row.accountId ?? '',
        dimensionValueIds: [...row.dimensionValueIds].sort(),
        currency: row.currency ?? ledgers.book,
        amount: amount.toString(),
        book: stated(ledgers.book, row.bookMinor),
        parallel: stated(ledgers.parallel, row.parallelMinor),
        itemReference: document ? row.itemReference.trim() : null,
        itemDueOn: document && row.itemDueOn.trim() !== '' ? row.itemDueOn.trim() : null,
        memo: row.memo.trim() === '' ? null : row.memo.trim(),
      };
    });
}

/** The dimension types the grid shows: those the lines' accounts require or already carry. */
function dimensionTypesOf(
  rows: readonly RecordRow[],
  accounts: ReadonlyMap<string, Account>,
  types: readonly DimensionType[],
  values: ReadonlyMap<string, DimensionValue>,
): DimensionType[] {
  const wanted = new Set<string>();
  for (const row of rows) {
    const account = row.accountId ? accounts.get(row.accountId) : undefined;
    for (const typeId of account?.requiredDimensionTypeIds ?? []) wanted.add(typeId);
    if (account?.isControl) {
      const client = types.find((type) => type.code === 'client');
      if (client) wanted.add(client.id);
    }
    for (const id of row.dimensionValueIds) {
      const value = values.get(id);
      if (value) wanted.add(value.typeId);
    }
  }
  return types.filter((type) => wanted.has(type.id)).sort((a, b) => a.position - b.position);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Step 2 (S10 "Screens"): the old records' lines in an entry grid. A monetary account's book and
 * parallel amounts are computed at the eve's rates and read only, with their rate and date once
 * saved; another line's are stated ("منقول") and typed, except in a ledger of the line's own
 * currency, where the amount is itself. Lines are added and removed by the entry keys.
 */
export function RecordsStep({
  rows,
  onRowsChange,
  editable,
  accounts,
  types,
  values,
  valuesOf,
  ledgers,
  computed,
  onEditError,
}: {
  rows: readonly RecordRow[];
  onRowsChange: (change: (rows: readonly RecordRow[]) => readonly RecordRow[]) => void;
  editable: boolean;
  accounts: readonly Account[];
  types: readonly DimensionType[];
  values: ReadonlyMap<string, DimensionValue>;
  valuesOf: (typeId: string) => readonly DimensionValue[];
  ledgers: LedgerCurrencies;
  /** A row's line in the saved preview, while nothing changed since the save. */
  computed: (row: RecordRow) => OpeningViewAnswer['lines'][number] | undefined;
  onEditError: (problem: GridProblem | null) => void;
}) {
  const grid = useRef<GridHandle>(null);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const accountOf = (row: RecordRow) => (row.accountId ? byId.get(row.accountId) : undefined);
  const dimensionTypes = dimensionTypesOf(rows, byId, types, values);
  const showsItems = rows.some((row) => accountOf(row)?.itemKind === 'document');
  const lineValue = (row: RecordRow, typeId: string) =>
    row.dimensionValueIds.map((id) => values.get(id)).find((value) => value?.typeId === typeId);

  /** A ledger's amount of a row: computed on a monetary line, the amount in its own currency. */
  const ledgerAmount = (row: RecordRow, ledger: 'book' | 'parallel'): bigint | null => {
    const account = accountOf(row);
    if (account?.isMonetary) {
      const line = computed(row);
      const value = ledger === 'book' ? line?.bookMinor : line?.parallelMinor;
      return value === undefined || value === null ? null : magnitude(BigInt(value));
    }
    const currency = ledger === 'book' ? ledgers.book : ledgers.parallel;
    if (currency !== null && currency === row.currency && row.amountMinor !== null) {
      return magnitude(row.amountMinor);
    }
    return ledger === 'book' ? row.bookMinor : row.parallelMinor;
  };
  const ledgerReadOnly = (row: RecordRow, ledger: 'book' | 'parallel') => {
    const currency = ledger === 'book' ? ledgers.book : ledgers.parallel;
    return !editable || accountOf(row)?.isMonetary === true || currency === row.currency;
  };
  const measureText = (row: RecordRow) => {
    const account = accountOf(row);
    if (!account) return '';
    if (!account.isMonetary) return t.stated;
    const line = computed(row);
    if (!line) return `${t.computed} · ${t.computedOnSave}`;
    const rates = line.conversions.map((conversion) =>
      fill(t.computedAt, {
        rate: `${conversion.base}/${conversion.quote} ${conversion.rate}`,
        date: conversion.effectiveOn,
      }),
    );
    return [t.computed, ...rates].join(' · ');
  };

  type Row = RecordRow & { readonly no: number };
  const gridRows: Row[] = rows.map((row, index) => ({ ...row, no: index + 1 }));
  const columns: GridColumnDef<Row>[] = [
    {
      id: 'no',
      type: 'text',
      header: t.lineNumber,
      readOnly: true,
      value: (row) => String(row.no),
      render: (row) => <bdi dir="ltr">{row.no}</bdi>,
    },
    {
      id: 'account',
      type: 'text',
      header: t.account,
      readOnly: !editable,
      value: (row) => accountOf(row)?.code ?? '',
      validate: (text) => {
        const code = text.trim();
        return code !== '' && !byCode.has(code) ? t.accountUnknown : accountProblem(code, byCode);
      },
      render: (row) => {
        const account = accountOf(row);
        return account ? (
          <AccountLabel code={account.code} name={account.name} className="max-w-64" />
        ) : null;
      },
    },
    ...dimensionTypes.map(
      (type): GridColumnDef<Row> => ({
        id: `dim:${type.id}`,
        type: 'text',
        header: <bdi>{type.name}</bdi>,
        readOnly: !editable,
        value: (row) => {
          const value = lineValue(row, type.id);
          return value ? (value.code ?? value.name) : '';
        },
        validate: (text) =>
          text.trim() === '' || findDimensionValue(valuesOf(type.id), text)
            ? undefined
            : t.valueUnknown,
        render: (row) => {
          const value = lineValue(row, type.id);
          return value ? <bdi>{value.name}</bdi> : null;
        },
      }),
    ),
    ...(showsItems
      ? ([
          {
            id: 'reference',
            type: 'text',
            header: t.reference,
            readOnly: (row: Row) => !editable || accountOf(row)?.itemKind !== 'document',
            value: (row: Row) => row.itemReference,
            validate: (text: string) => (text.trim().length > 100 ? t.referenceLength : undefined),
            render: (row: Row) => <bdi dir="ltr">{row.itemReference}</bdi>,
          },
          {
            id: 'dueOn',
            type: 'text',
            header: t.dueOn,
            readOnly: (row: Row) => !editable || accountOf(row)?.itemKind !== 'document',
            value: (row: Row) => row.itemDueOn,
            validate: (text: string) =>
              text.trim() === '' || DATE.test(text.trim()) ? undefined : t.dateInvalid,
            render: (row: Row) => <bdi dir="ltr">{row.itemDueOn}</bdi>,
          },
        ] satisfies GridColumnDef<Row>[])
      : []),
    {
      id: 'currency',
      type: 'text',
      header: t.currency,
      readOnly: !editable,
      value: (row) => row.currency ?? '',
      validate: (text) =>
        text.trim() === '' || CURRENCY_CODES.includes(text.trim().toUpperCase() as CurrencyCode)
          ? undefined
          : t.currencyUnknown,
      render: (row) => <bdi dir="ltr">{row.currency}</bdi>,
    },
    ...(['debit', 'credit'] as const).map(
      (side): GridColumnDef<Row> => ({
        id: side,
        type: 'amount',
        kind: 'transaction',
        header: side === 'debit' ? t.debit : t.credit,
        readOnly: !editable,
        allowNegative: false,
        currency: (row) => row.currency ?? ledgers.book,
        valueMinor: (row) => {
          const sides = debitCreditOf(row.amountMinor);
          return side === 'debit' ? sides.debitMinor : sides.creditMinor;
        },
      }),
    ),
    {
      id: 'measure',
      type: 'text',
      header: t.measure,
      readOnly: true,
      value: measureText,
      render: (row) => <span className="whitespace-nowrap">{measureText(row)}</span>,
    },
    ...(['book', 'parallel'] as const)
      .filter((ledger) => ledger === 'book' || ledgers.parallel !== null)
      .map(
        (ledger): GridColumnDef<Row> => ({
          id: ledger,
          type: 'amount',
          kind: ledger,
          header: `${ledger === 'book' ? t.book : t.parallel} (${ledger === 'book' ? ledgers.book : ledgers.parallel})`,
          readOnly: (row) => ledgerReadOnly(row, ledger),
          allowNegative: false,
          currency: () => (ledger === 'book' ? ledgers.book : (ledgers.parallel ?? ledgers.book)),
          valueMinor: (row) => ledgerAmount(row, ledger),
        }),
      ),
    {
      id: 'memo',
      type: 'text',
      header: t.memo,
      readOnly: !editable,
      value: (row) => row.memo,
      validate: (text) => (text.trim().length > 300 ? t.memoLength : undefined),
      render: (row) => <bdi className="block max-w-64 truncate">{row.memo}</bdi>,
    },
  ];

  function withDimension(row: RecordRow, typeId: string, valueId: string | null): RecordRow {
    const others = row.dimensionValueIds.filter((id) => values.get(id)?.typeId !== typeId);
    return { ...row, dimensionValueIds: valueId === null ? others : [...others, valueId] };
  }

  function applyEdits(edits: readonly CellEdit[]) {
    onRowsChange((current) => {
      const next = [...current];
      for (const cell of edits) {
        const row = next[cell.row];
        const column = columns[cell.column]?.id;
        if (!row || !column) continue;
        if (cell.type === 'amount') {
          if (column === 'debit' || column === 'credit') {
            next[cell.row] =
              cell.amountMinor === null || cell.amountMinor === 0n
                ? { ...row, amountMinor: null }
                : { ...row, amountMinor: signedAmount(column, cell.amountMinor) };
          } else if (column === 'book') next[cell.row] = { ...row, bookMinor: cell.amountMinor };
          else if (column === 'parallel') {
            next[cell.row] = { ...row, parallelMinor: cell.amountMinor };
          }
          continue;
        }
        const text = cell.text.trim();
        if (column === 'account') {
          const account = text === '' ? undefined : byCode.get(text);
          next[cell.row] = {
            ...row,
            accountId: account?.id ?? null,
            currency: row.currency ?? account?.currency ?? ledgers.book,
          };
        } else if (column.startsWith('dim:')) {
          const typeId = column.slice(4);
          const value = text === '' ? undefined : findDimensionValue(valuesOf(typeId), text);
          next[cell.row] = withDimension(row, typeId, value?.id ?? null);
        } else if (column === 'reference') next[cell.row] = { ...row, itemReference: cell.text };
        else if (column === 'dueOn') next[cell.row] = { ...row, itemDueOn: text };
        else if (column === 'currency') {
          next[cell.row] = {
            ...row,
            currency: text === '' ? null : (text.toUpperCase() as CurrencyCode),
          };
        } else if (column === 'memo') next[cell.row] = { ...row, memo: cell.text };
      }
      return next;
    });
  }

  function addLine() {
    onRowsChange((current) => [...current, emptyRecordRow()]);
    grid.current?.focusCell({ row: rows.length, column: 1 });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!editable) return;
    const native = event.nativeEvent;
    const cell = gridCellOf(event.target);
    const row = cell ? rows[cell.row] : undefined;
    if (matchesShortcut(native, keymap.addLine)) {
      event.preventDefault();
      addLine();
    } else if (cell && row && matchesShortcut(native, keymap.deleteLine)) {
      event.preventDefault();
      onRowsChange((current) =>
        current.length <= 1 ? [emptyRecordRow()] : current.filter((line) => line.key !== row.key),
      );
      grid.current?.focusCell({
        row: Math.max(0, Math.min(cell.row, rows.length - 2)),
        column: cell.column,
      });
    } else if (cell && row && matchesShortcut(native, keymap.insertLine)) {
      event.preventDefault();
      onRowsChange((current) => [
        ...current.slice(0, cell.row),
        emptyRecordRow(),
        ...current.slice(cell.row),
      ]);
      grid.current?.focusCell({ row: cell.row, column: 1 });
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the entry keys (add, insert and delete a line) are component keys of the records' grid (ADR 0010 §4).
    <div className="flex min-w-0 flex-col gap-3" onKeyDown={onKeyDown}>
      <Grid
        className="max-h-[32rem]"
        aria-label={t.grid}
        rows={gridRows}
        columns={columns}
        rowKey={(row) => row.key}
        enterMoves="next"
        handle={grid}
        stickyStartColumn
        describeProblem={gridProblemText}
        summaryLabels={ar.grid.summary}
        empty={t.empty}
        {...(editable ? { onEdit: applyEdits, onEditError } : {})}
      />
      {editable && (
        <Button variant="outline" size="sm" className="w-fit" onClick={addLine}>
          <PlusIcon aria-hidden="true" />
          {t.addLine}
          <Kbd shortcut={keymap.addLine} />
        </Button>
      )}
    </div>
  );
}
