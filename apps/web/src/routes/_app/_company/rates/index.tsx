import { createFileRoute } from '@tanstack/react-router';
import type { RateType } from '@vertex-mizan/contracts';
import { RatesPage } from '../../../../features/rates/rates-page';
import { requirePermission } from '../../../../lib/session';

/** `record`: the command palette's "record bulletin rate" opens the record dialog. */
export const Route = createFileRoute('/_app/_company/rates/')({
  validateSearch: (search: Record<string, unknown>): { record?: RateType | undefined } => ({
    record: search.record === 'bulletin' || search.record === 'market' ? search.record : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'rates.read'),
  component: RatesPage,
});
