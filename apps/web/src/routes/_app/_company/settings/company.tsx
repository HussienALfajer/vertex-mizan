import { createFileRoute } from '@tanstack/react-router';
import { CompanySettingsPage } from '../../../../features/company/company-settings-page';

export const Route = createFileRoute('/_app/_company/settings/company')({
  component: CompanySettingsPage,
});
