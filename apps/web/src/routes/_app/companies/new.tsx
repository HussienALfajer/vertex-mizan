import { createFileRoute } from '@tanstack/react-router';
import { NewCompanyPage } from '../../../features/company/new-company-page';

export const Route = createFileRoute('/_app/companies/new')({ component: NewCompanyPage });
