import type { Party } from '@vertex-mizan/contracts';
import { Button, DimensionPicker, Field, FieldError, FieldLabel, Input } from '@vertex-mizan/ui';

/** A party chosen from the list, or a new one by its name, created with what it is chosen for. */
export type PartyChoice = { id: string | null } | { newName: string };

export interface PartyFieldLabels {
  label: string;
  placeholder: string;
  empty: string;
  newParty: string;
  newPartyName: string;
  pickExisting: string;
}

/**
 * A client or a supplier (S13 "In scope": added by name where they are needed): picked from the
 * company's parties, or typed as a new name.
 */
export function PartyField({
  id,
  parties,
  value,
  onValueChange,
  labels,
  error,
  description,
}: {
  id: string;
  parties: readonly Party[];
  value: PartyChoice;
  onValueChange: (value: PartyChoice) => void;
  labels: PartyFieldLabels;
  error?: string | undefined;
  description?: string | undefined;
}) {
  if ('newName' in value) {
    return (
      <div className="flex flex-col gap-1">
        <Field id={id} invalid={error !== undefined}>
          <FieldLabel>{labels.newPartyName}</FieldLabel>
          <Input
            value={value.newName}
            maxLength={200}
            onChange={(event) => onValueChange({ newName: event.target.value })}
          />
          <FieldError match={error !== undefined}>{error}</FieldError>
        </Field>
        <Button
          variant="link"
          size="sm"
          className="w-fit px-0"
          onClick={() => onValueChange({ id: null })}
        >
          {labels.pickExisting}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <DimensionPicker
        id={id}
        label={labels.label}
        values={parties}
        value={value.id}
        onValueChange={(chosen) => onValueChange({ id: chosen })}
        labels={{ placeholder: labels.placeholder, empty: labels.empty }}
        error={error}
        description={description}
      />
      <Button
        variant="link"
        size="sm"
        className="w-fit px-0"
        onClick={() => onValueChange({ newName: '' })}
      >
        {labels.newParty}
      </Button>
    </div>
  );
}
