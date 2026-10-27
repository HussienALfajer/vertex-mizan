import { createFileRoute } from '@tanstack/react-router';
import { InvitationPage } from '../../features/auth/invitation-page';

export const Route = createFileRoute('/_auth/invitation')({ component: InvitationPage });
