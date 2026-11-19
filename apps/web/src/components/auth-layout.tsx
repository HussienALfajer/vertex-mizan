import { useQuery } from '@tanstack/react-query';
import { ar } from '@vertex-mizan/i18n';
import { Card, CompanyLogo, Skeleton, ThemeToggle } from '@vertex-mizan/ui';
import type { ReactNode } from 'react';
import { displayName, logoUrl, publicBrandingQuery, useCompanyTab } from '../lib/branding';

const { common } = ar;

/**
 * The frame of the pages a person sees before the app: one card in the middle under the
 * company's logo and name (S13 screen 1), no navigation. Never the product's own name or mark
 * (ADR 0024 §8): without a company named for the sign-in page, or while its branding cannot be
 * read, a generic title.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center bg-background px-4 py-8">
      <div className="absolute end-4 top-4">
        <ThemeToggle labels={common.theme} />
      </div>
      <main
        id="main"
        tabIndex={-1}
        className="relative flex w-full max-w-md flex-1 flex-col justify-center gap-6 outline-none"
      >
        <SignInBrand />
        <Card className="gap-5 p-6">{children}</Card>
      </main>
    </div>
  );
}

function SignInBrand() {
  const branding = useQuery(publicBrandingQuery);
  const named = branding.data?.displayName.trim() || undefined;
  const logo = logoUrl(branding.data, '/branding/public/logo');
  useCompanyTab(named, logo);
  if (branding.isPending) {
    return <Skeleton className="h-28 w-48 self-center" />;
  }
  if (!named && !logo) {
    return <p className="text-center text-2xl font-bold text-foreground">{common.productName}</p>;
  }
  const name = displayName(branding.data);
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <CompanyLogo
        src={logo}
        size="lg"
        className="text-primary"
        imageClassName="rounded-md bg-sidebar-foreground p-2"
      />
      <p className="text-xl font-bold text-foreground">
        <bdi>{name}</bdi>
      </p>
    </div>
  );
}

/** A page's heading and its line of explanation inside the auth card. */
export function AuthHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-xl font-bold text-foreground">{title}</h1>
      {description && <p className="text-control text-muted-foreground">{description}</p>}
    </div>
  );
}
