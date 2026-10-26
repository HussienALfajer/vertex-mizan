import { ar } from '@vertex-mizan/i18n';
import { PageHeader } from '@vertex-mizan/ui';
import { SystemStatus } from '../../components/system-status';

const t = ar.shell.home;

/** The first page: the product and the system's health. Phase 1's screens arrive with their specs. */
export function HomePage() {
  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      <SystemStatus />
    </>
  );
}
