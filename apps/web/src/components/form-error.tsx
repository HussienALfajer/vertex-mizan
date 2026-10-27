import { Callout } from '@vertex-mizan/ui';
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
