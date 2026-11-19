import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  type AmountTextError,
  type CurrencyCode,
  createProjectSchema,
  projectSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AmountInput,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
  Input,
  SelectField,
} from '@vertex-mizan/ui';
import { useState } from 'react';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { api } from '../../lib/api';
import { damascusToday } from '../../lib/format';
import { MOVEMENT_CURRENCIES, partiesQuery, refreshBooks } from '../../lib/movements';
import { type PartyChoice, PartyField } from './party-field';

const t = ar.movements.newProject;

/**
 * A new project (S13 screen 3): its name, its client picked or added by name, its start date and,
 * optionally, its contract value. The new project's page opens after it.
 */
export function NewProjectDialog({
  companyId,
  open,
  onOpenChange,
}: {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={ar.common.close}>
        {open && <NewProjectForm companyId={companyId} />}
      </DialogContent>
    </Dialog>
  );
}

type Errors = Partial<Record<'name' | 'client' | 'start' | 'value', string>>;

function NewProjectForm({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const clients = useQuery(partiesQuery(companyId, 'client'));
  const [name, setName] = useState('');
  const [client, setClient] = useState<PartyChoice>({ id: null });
  const [startDate, setStartDate] = useState(damascusToday);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [value, setValue] = useState<bigint | null>(null);
  const [valueError, setValueError] = useState<AmountTextError | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [attempt, setAttempt] = useState(0);
  const create = useMutation({
    mutationFn: (body: unknown) =>
      api('POST', '/project-books', { company: companyId, body, schema: projectSchema }),
    onSuccess: async (project) => {
      await refreshBooks(queryClient, companyId);
      await navigate({ to: '/projects/$projectId', params: { projectId: project.id } });
    },
  });

  function validate(): Errors {
    const found: Errors = {};
    if (name.trim() === '') found.name = t.nameRequired;
    else if (name.trim().length > 200) found.name = t.tooLong;
    if ('newName' in client) {
      if (client.newName.trim() === '') found.client = t.clientRequired;
      else if (client.newName.trim().length > 200) found.client = t.tooLong;
    } else if (client.id === null) found.client = t.clientRequired;
    if (startDate === '') found.start = ar.movements.dialog.required;
    if (valueError) found.value = ar.accounting.amountInput[valueError];
    else if (value !== null && value <= 0n) found.value = ar.movements.dialog.amountRequired;
    return found;
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const found = validate();
        setErrors(found);
        if (Object.keys(found).length > 0) {
          setAttempt((count) => count + 1);
          return;
        }
        create.mutate(
          createProjectSchema.parse({
            name,
            clientId: 'id' in client ? client.id : null,
            clientName: 'newName' in client ? client.newName : null,
            startDate,
            contractValue: value === null ? null : { amountMinor: String(value), currency },
          }),
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>{t.title}</DialogTitle>
        <DialogDescription>{t.description}</DialogDescription>
      </DialogHeader>
      <FormErrorSummary
        attempt={attempt}
        errors={[
          ['project-name', errors.name],
          ['project-client', errors.client],
          ['project-start', errors.start],
          ['project-value', errors.value],
        ]}
      />
      <Field id="project-name" invalid={errors.name !== undefined}>
        <FieldLabel>{t.name}</FieldLabel>
        <Input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
        <FieldError match={errors.name !== undefined}>{errors.name}</FieldError>
      </Field>
      <PartyField
        id="project-client"
        parties={clients.data ?? []}
        value={client}
        onValueChange={setClient}
        labels={{
          label: t.client,
          placeholder: t.clientPlaceholder,
          empty: t.clientEmpty,
          newParty: t.newClient,
          newPartyName: t.newClientName,
          pickExisting: t.pickClient,
        }}
        error={errors.client}
      />
      <Field id="project-start" invalid={errors.start !== undefined}>
        <FieldLabel>{t.startDate}</FieldLabel>
        <Input
          type="date"
          dir="ltr"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
        <FieldError match={errors.start !== undefined}>{errors.start}</FieldError>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <Field id="project-value" invalid={errors.value !== undefined}>
          <FieldLabel>{t.contractValue}</FieldLabel>
          <AmountInput
            currency={currency}
            value={value}
            allowNegative={false}
            onValueChange={setValue}
            onTextError={setValueError}
          />
          <FieldError match={errors.value !== undefined}>{errors.value}</FieldError>
        </Field>
        <SelectField
          label={t.currency}
          value={currency}
          options={MOVEMENT_CURRENCIES.map((code) => ({
            value: code,
            label: ar.accounting.currencies[code],
          }))}
          onValueChange={setCurrency}
        />
      </div>
      <FormError error={create.error} />
      <DialogFooter>
        <Button type="submit" loading={create.isPending}>
          {t.submit}
        </Button>
      </DialogFooter>
    </form>
  );
}
