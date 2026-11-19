import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ar } from '@vertex-mizan/i18n';
import { Button } from '@vertex-mizan/ui';
import { LogOutIcon } from 'lucide-react';
import { AuthHeading } from '../../components/auth-layout';
import { FormError } from '../../components/form-error';
import { api } from '../../lib/api';

const t = ar.auth.noCompany;

/**
 * `/no-company`: signed in, but no company is active (a person with several memberships, or whose
 * membership was archived). S13 has no companies screen (ADR 0024): ask Vertex, or sign out.
 */
export function NoCompanyPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationFn: () => api('POST', '/auth/sign-out'),
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: '/sign-in', search: { redirect: undefined } });
    },
  });
  return (
    <div className="flex flex-col gap-5">
      <AuthHeading title={t.title} description={t.description} />
      <FormError error={signOut.error} />
      <Button variant="outline" loading={signOut.isPending} onClick={() => signOut.mutate()}>
        <LogOutIcon aria-hidden="true" />
        {t.signOut}
      </Button>
    </div>
  );
}
