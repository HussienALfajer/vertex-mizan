import { createFileRoute } from '@tanstack/react-router';
import { DesignSystemPage } from '../features/design-system/design-system-page';

export const Route = createFileRoute('/design-system')({ component: DesignSystemPage });
