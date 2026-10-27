import { useMutation, useQueryClient } from '@tanstack/react-query';
import { companySchema, createCompanySchema } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Button,
  Callout,
  Card,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  Textarea,
} from '@vertex-mizan/ui';
import { CircleCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { FormError } from '../../components/form-error';
import { api } from '../../lib/api';
import { meQuery } from '../../lib/session';
import { useSwitchCompany } from './company-queries';
import {
  LedgerFields,
  type LedgerForm,
  ledgerFormError,
  ledgersOf,
  vertexMediaLedgers,
} from './ledger-fields';
import { nameError, policyNoteError } from './validation';

const t = ar.company;

/**
 * `/companies/new` (S01 rules 9–10): a company with its ledger settings, Vertex Media's shape
 * pre-filled. The creator becomes its owner, and it becomes the active company.
 */
export function NewCompanyPage() {
  const [name, setName] = useState('');
  const [nameLatin, setNameLatin] = useState('');
  const [policyNote, setPolicyNote] = useState('');
  const [ledgers, setLedgers] = useState<LedgerForm>(vertexMediaLedgers);
  const [errors, setErrors] = useState<{
    name?: string | undefined;
    policyNote?: string | undefined;
    latin?: string | undefined;
  }>({});
  const queryClient = useQueryClient();
  const open = useSwitchCompany();
  const create = useMutation({
    mutationFn: () =>
      api('POST', '/companies', {
        body: createCompanySchema.parse({
          name,
          nameLatin: nameLatin.trim() === '' ? null : nameLatin,
          ledgers: ledgersOf(ledgers),
          fiscalYearStartMonth: ledgers.fiscalYearStartMonth,
          policyNote,
        }),
        schema: companySchema,
      }),
    onSuccess: async (company) => {
      await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
      open.mutate(company.id);
    },
  });
  const created = create.data !== undefined;

  return (
    <>
      <PageHeader title={t.create.title} description={t.create.description} />
      <Card className="p-6">
        <form
          noValidate
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            // Created already, the switch failed: retry only the switch, never a second company.
            if (create.data) {
              open.mutate(create.data.id);
              return;
            }
            const found = {
              name: nameError(name),
              policyNote: policyNoteError(policyNote),
              latin: nameLatin.trim() === '' ? undefined : nameError(nameLatin),
            };
            setErrors(found);
            if (found.name || found.policyNote || found.latin || ledgerFormError(ledgers)) return;
            create.mutate();
          }}
        >
          {/* Once created, the values are the company's: nothing typed after it is sent. */}
          <fieldset disabled={created} className="flex min-w-0 flex-col gap-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field invalid={errors.name !== undefined}>
                <FieldLabel>{t.fields.name}</FieldLabel>
                <Input
                  value={name}
                  maxLength={200}
                  onChange={(event) => setName(event.target.value)}
                />
                <FieldError match={errors.name !== undefined}>{errors.name}</FieldError>
              </Field>
              <Field invalid={errors.latin !== undefined}>
                <FieldLabel>{t.fields.nameLatin}</FieldLabel>
                <Input
                  dir="ltr"
                  value={nameLatin}
                  maxLength={200}
                  onChange={(event) => setNameLatin(event.target.value)}
                />
                <FieldDescription>{t.fields.nameLatinHint}</FieldDescription>
                <FieldError match={errors.latin !== undefined}>{errors.latin}</FieldError>
              </Field>
            </div>
            <LedgerFields value={ledgers} onChange={setLedgers} />
            <Field invalid={errors.policyNote !== undefined}>
              <FieldLabel>{t.fields.policyNote}</FieldLabel>
              <Textarea
                value={policyNote}
                maxLength={4000}
                onChange={(event) => setPolicyNote(event.target.value)}
              />
              <FieldDescription>{t.fields.policyNoteHint}</FieldDescription>
              <FieldError match={errors.policyNote !== undefined}>{errors.policyNote}</FieldError>
            </Field>
          </fieldset>
          {created && (
            <Callout
              role="status"
              tone="info"
              icon={<CircleCheckIcon />}
              title={t.create.created}
            />
          )}
          <FormError error={create.error ?? open.error} />
          <Button type="submit" className="w-fit" loading={create.isPending || open.isPending}>
            {created ? t.create.open : t.create.submit}
          </Button>
        </form>
      </Card>
    </>
  );
}
