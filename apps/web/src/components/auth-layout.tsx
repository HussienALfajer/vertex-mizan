import { useQuery } from '@tanstack/react-query';
import { ar } from '@vertex-mizan/i18n';
import {
  AscentLines,
  Card,
  CompanyLogo,
  PoweredBy,
  Skeleton,
  ThemeToggle,
  VertexMizanLogo,
} from '@vertex-mizan/ui';
import type { ReactNode } from 'react';
import { displayName, logoUrl, publicBrandingQuery } from '../lib/branding';

const { common } = ar;

/**
 * The frame of the pages a person sees before the app: one card in the middle under the
 * company's logo and name (S13 screen 1), no navigation. Without a company named for the sign-in
 * page, or while its branding cannot be read, the product's own logo.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center bg-background px-4 py-8">
      <div className="absolute end-4 top-4">
        <ThemeToggle labels={common.theme} />
      </div>
      <AscentLines className="absolute inset-y-0 start-0 hidden h-full w-24 text-border lg:block" />
      <main
        id="main"
        tabIndex={-1}
        className="relative flex w-full max-w-md flex-1 flex-col justify-center gap-6 outline-none"
      >
        <SignInBrand />
        <Card className="gap-5 p-6">{children}</Card>
      </main>
      <PoweredBy label={common.poweredBy} className="relative mt-8" />
    </div>
  );
}

function SignInBrand() {
  const branding = useQuery(publicBrandingQuery);
  if (branding.isPending) {
    return <Skeleton className="h-20 w-48 self-center" />;
  }
  const named = branding.data?.displayName.trim();
  if (!named && !branding.data?.hasLogo) {
    return (
      <VertexMizanLogo
        label={common.productName}
        className="h-14 w-auto self-center text-primary"
      />
    );
  }
  const name = displayName(branding.data);
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <CompanyLogo
        src={logoUrl(branding.data, '/branding/public/logo')}
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
