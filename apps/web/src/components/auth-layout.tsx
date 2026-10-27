import { ar } from '@vertex-mizan/i18n';
import { AscentLines, Card, PoweredBy, ThemeToggle, VertexMizanLogo } from '@vertex-mizan/ui';
import type { ReactNode } from 'react';

const { common } = ar;

/**
 * The frame of the pages a person sees before the app: signing in, two-factor, passwords,
 * invitations and enrolment. One card in the middle, the logo above it, no navigation.
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
        <VertexMizanLogo
          label={common.productName}
          className="h-14 w-auto self-center text-primary"
        />
        <Card className="gap-5 p-6">{children}</Card>
      </main>
      <PoweredBy label={common.poweredBy} className="relative mt-8" />
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
