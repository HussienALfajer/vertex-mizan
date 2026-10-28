import { ar } from '@vertex-mizan/i18n';
import { Callout, ErrorSummary } from '@vertex-mizan/ui';
import { CircleAlertIcon } from 'lucide-react';
import { errorText } from '../lib/api';
import { isCancelled } from './reauth-dialog';

/**
 * A form's refusal, announced: the Arabic text of the API's error code. Nothing when the person
 * cancelled a re-authentication.
 */
export function FormError({ error }: { error: unknown }) {
  if (!error || isCancelled(error)) return null;
  return <Callout role="alert" tone="danger" icon={<CircleAlertIcon />} title={errorText(error)} />;
}

/**
 * A refused submit's field errors above the form, each linking to its field (ADR 0010 §4): pairs
 * of the field's `Field` id and its error, in the form's order; fields without an error are left
 * out. Count the refused submits in `attempt`: the summary takes focus at each.
 */
export function FormErrorSummary({
  errors,
  attempt,
}: {
  errors: readonly (readonly [fieldId: string, error: string | undefined])[];
  attempt: number;
}) {
  return (
    <ErrorSummary
      title={ar.common.errorSummary}
      attempt={attempt}
      errors={errors.flatMap(([fieldId, message]) => (message ? [{ fieldId, message }] : []))}
    />
  );
}
