import { createFileRoute } from '@tanstack/react-router';
import { CompaniesPage } from '../../../features/company/companies-page';

export const Route = createFileRoute('/_app/companies/')({ component: CompaniesPage });
