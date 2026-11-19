import { createFileRoute } from '@tanstack/react-router';
import { HomePage } from '../../features/home/home-page';

/** The first page: the product and the system's health, until the dashboard arrives (S13 PR 4). */
export const Route = createFileRoute('/_app/')({
  component: HomePage,
});
