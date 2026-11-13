import {
  type AmountTextError,
  type CurrencyCode,
  type DimensionValue,
  HUB_CURRENCIES,
  OPENING_FIGURE_SLOTS,
  type OpeningFigureInput,
  type OpeningFigureSlot,
  type OpeningViewAnswer,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  type AgreementRow,
  AgreementTable,
  AmountInput,
  Button,
  DimensionPicker,
  SelectField,
} from '@vertex-mizan/ui';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { dimensionPickerLabels, pickerValues } from '../entries/entry-parts';
import { ClientName } from './opening-parts';

const t = ar.opening.agreement;

/** A records' figure as typed, keyed by slot, client value and currency (rule 15). */
export interface FigureEdit {
  readonly slot: OpeningFigureSlot;
  readonly clientValueId: string;
  readonly currency: CurrencyCode;
  readonly amountMinor: bigint | null;
}

export const figureKey = (figure: {
  readonly slot: string;
  readonly clientValueId: string;
  readonly currency: string;
}) => `${figure.slot}:${figure.clientValueId}:${figure.currency}`;

/** The saved figures as typed ones. */
export function figuresOf(view: OpeningViewAnswer): FigureEdit[] {
  return view.recordFigures.map((figure) => ({
    slot: figure.slot,
    clientValueId: figure.clientValueId,
    currency: figure.currency,
    amountMinor: BigInt(figure.amountMinor),
  }));
}

/** The figures `PUT /api/opening` takes: a figure not entered is left out (a difference). */
export function figuresInput(figures: readonly FigureEdit[]): OpeningFigureInput[] {
  return figures.flatMap((figure) =>
    figure.amountMinor === null
      ? []
      : [
          {
            slot: figure.slot,
            clientValueId: figure.clientValueId,
            currency: figure.currency,
            amount: figure.amountMinor.toString(),
          },
        ],
  );
}

/**
 * Step 3 (S10 "Screens"): per client and currency on the receivables and client funds, the old
 * records' figure (typed here), Hub's items and the difference. Hub's pairs come from the view;
 * a figure typed since the save shows whether it agrees, and its difference once saved. A client
 * the records hold and Hub does not is added below.
 */
export function AgreementStep({
  view,
  figures,
  onFiguresChange,
  editable,
  clients,
  values,
  onTextError,
}: {
  view: OpeningViewAnswer;
  figures: readonly FigureEdit[];
  onFiguresChange: (figures: readonly FigureEdit[]) => void;
  editable: boolean;
  /** The client dimension's values, for a client Hub does not hold. */
  clients: readonly DimensionValue[];
  values: ReadonlyMap<string, DimensionValue>;
  onTextError: (key: string, error: AmountTextError | null) => void;
}) {
  const typed = new Map(figures.map((figure) => [figureKey(figure), figure]));
  const saved = new Map(view.recordFigures.map((figure) => [figureKey(figure), figure]));
  const pairs = new Map(
    view.agreement.map((pair) => [
      figureKey({ slot: pair.slot, clientValueId: pair.client, currency: pair.currency }),
      pair,
    ]),
  );
  const keys = [...pairs.keys(), ...[...typed.keys()].filter((key) => !pairs.has(key))];

  const setFigure = (figure: FigureEdit) => {
    const key = figureKey(figure);
    onFiguresChange(
      typed.has(key)
        ? figures.map((current) => (figureKey(current) === key ? figure : current))
        : [...figures, figure],
    );
  };

  const rows: AgreementRow[] = keys.map((key) => {
    const pair = pairs.get(key);
    const figure = typed.get(key);
    const slot = (pair?.slot ?? figure?.slot ?? 'receivable') as OpeningFigureSlot;
    const client = pair?.client ?? figure?.clientValueId ?? '';
    const currency = (pair?.currency ?? figure?.currency ?? 'USD') as CurrencyCode;
    const hubMinor = BigInt(pair?.hubMinor ?? '0');
    const recordsMinor = figure?.amountMinor ?? null;
    const savedMinor = saved.get(key)?.amountMinor ?? null;
    const unchanged =
      (recordsMinor === null && savedMinor === null) ||
      (recordsMinor !== null && savedMinor !== null && recordsMinor === BigInt(savedMinor));
    const status =
      recordsMinor === null ? 'missing' : recordsMinor === hubMinor ? 'agrees' : 'differs';
    const linked = !client.startsWith('hub:');
    return {
      key,
      group: t.slots[slot],
      label: <ClientName view={view} client={client} values={values} />,
      currency,
      recordsMinor,
      hubMinor,
      differenceMinor:
        unchanged && pair?.differenceMinor !== undefined && pair.differenceMinor !== null
          ? BigInt(pair.differenceMinor)
          : null,
      status,
      ...(editable &&
        linked && {
          records: (
            <AmountInput
              aria-label={`${t.records} · ${t.slots[slot]} · ${currency}`}
              currency={currency}
              value={recordsMinor}
              className="ms-auto w-36"
              onValueChange={(amountMinor) =>
                setFigure({ slot, clientValueId: client, currency, amountMinor })
              }
              onTextError={(error) => onTextError(key, error)}
            />
          ),
        }),
    };
  });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <AgreementTable
        caption={t.table}
        rows={rows}
        empty={t.empty}
        labels={{
          group: t.slot,
          row: t.client,
          currency: t.currency,
          records: t.records,
          hub: t.hub,
          difference: t.difference,
          status: t.status,
          statuses: { agrees: t.agrees, differs: t.differs, missing: t.missing },
        }}
      />
      {editable && (
        <AddClient
          clients={clients}
          onAdd={(figure) => {
            if (typed.has(figureKey(figure)) || pairs.has(figureKey(figure))) return false;
            onFiguresChange([...figures, figure]);
            return true;
          }}
        />
      )}
    </div>
  );
}

/** A client the records hold and Hub does not (rule 15): its slot and currency, no figure yet. */
function AddClient({
  clients,
  onAdd,
}: {
  clients: readonly DimensionValue[];
  onAdd: (figure: FigureEdit) => boolean;
}) {
  const a = t.add;
  const [client, setClient] = useState<string | null>(null);
  const [slot, setSlot] = useState<OpeningFigureSlot>('receivable');
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [error, setError] = useState<string | undefined>();
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4">
      <legend className="px-1 font-medium">{a.title}</legend>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_auto] xl:items-end">
        <DimensionPicker
          label={a.client}
          values={pickerValues(clients)}
          value={client}
          onValueChange={(id) => {
            setClient(id);
            setError(undefined);
          }}
          labels={dimensionPickerLabels}
          error={error}
        />
        <SelectField
          label={a.slot}
          value={slot}
          onValueChange={setSlot}
          options={OPENING_FIGURE_SLOTS.map((value) => ({ value, label: t.slots[value] }))}
        />
        <SelectField
          label={a.currency}
          value={currency}
          onValueChange={setCurrency}
          options={HUB_CURRENCIES.map((value) => ({ value, label: value }))}
        />
        <Button
          variant="outline"
          onClick={() => {
            if (client === null) {
              setError(a.required);
              return;
            }
            if (onAdd({ slot, clientValueId: client, currency, amountMinor: null })) {
              setClient(null);
              setError(undefined);
            } else setError(a.exists);
          }}
        >
          <PlusIcon aria-hidden="true" />
          {a.submit}
        </Button>
      </div>
    </fieldset>
  );
}
