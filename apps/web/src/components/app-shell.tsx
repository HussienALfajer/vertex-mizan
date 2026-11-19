import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, type LinkProps, useNavigate, useRouter } from '@tanstack/react-router';
import type { Branding, Me, Permission } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Button,
  Callout,
  CommandPalette,
  CompanyLogo,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHeader,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  type PaletteCommand,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  setDensity,
  setTheme,
  ThemeToggle,
} from '@vertex-mizan/ui';
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  CircleUserIcon,
  FolderKanbanIcon,
  HouseIcon,
  LogOutIcon,
  type LucideIcon,
  MenuIcon,
  MoonIcon,
  RowsIcon,
  SettingsIcon,
  SunIcon,
  SwatchBookIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { api } from '../lib/api';
import { brandingQuery, displayName, logoUrl, useCompanyTab } from '../lib/branding';
import { activeMembership, can, meQuery } from '../lib/session';

const t = ar.shell;
const { common } = ar;

interface NavItem {
  to: NonNullable<LinkProps['to']>;
  label: string;
  icon: LucideIcon;
  /** Active only on this exact path; otherwise also on its sub-pages. */
  exact?: boolean;
  /** Lists the item only when this holds; the page stays reachable. */
  show?: (me: Me | null | undefined) => boolean;
  /** Lists the item only for a person holding this permission in the active company (cosmetic). */
  permission?: Permission;
}

const navItems: NavItem[] = [
  { to: '/', label: t.nav.home, icon: HouseIcon, exact: true },
  {
    to: '/projects',
    label: t.nav.projects,
    icon: FolderKanbanIcon,
    show: (me) => Boolean(me),
    permission: 'reports.read',
  },
  {
    to: '/settings',
    label: t.nav.settings,
    icon: SettingsIcon,
    exact: true,
    show: (me) => Boolean(me),
    permission: 'company.read',
  },
  {
    to: '/design-system',
    label: t.nav.designSystem,
    icon: SwatchBookIcon,
    exact: true,
    show: () => import.meta.env.DEV,
  },
];

const listedItems = (me: Me | null | undefined) =>
  navItems.filter(
    (item) =>
      (!item.show || item.show(me)) &&
      (!item.permission || (me ? can(me, item.permission) : false)),
  );

/**
 * Green navigation, a gold marker on the active page (brand/identity.md §2, §7), and never the
 * product's own name or mark (ADR 0024 §8): the company's, or a generic title. Signed
 * in, the sidebar and the phone's top bar show the company's logo and display name (S13
 * "Screens"), the top bar carries the person's menu (settings, sign out), and an archived company
 * shows its banner on every page (S01 rule 12).
 */
export function AppShell({
  children,
  signedIn = false,
}: {
  children: ReactNode;
  signedIn?: boolean;
}) {
  const me = useQuery({ ...meQuery, enabled: signedIn }).data;
  const company = me ? activeMembership(me)?.company : undefined;
  const archived = company?.archived ?? false;
  const branding = useQuery({
    ...brandingQuery(company?.id ?? ''),
    enabled: company !== undefined,
  }).data;
  const brand = company ? { branding, fallback: company.name } : undefined;
  useCompanyTab(
    brand && displayName(brand.branding, brand.fallback),
    logoUrl(branding, '/company/branding/logo'),
  );
  return (
    <div className="flex min-h-dvh bg-background">
      {/* Keyboard users skip the navigation on every page (WCAG 2.4.1). */}
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:start-4 focus-visible:top-4 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-surface focus-visible:px-4 focus-visible:py-2 focus-visible:font-medium focus-visible:text-foreground focus-visible:shadow-float"
      >
        {t.skipToContent}
      </a>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 md:flex">
        <Sidebar me={me} brand={brand} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar me={me} brand={brand} />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          <div className="mx-auto flex max-w-6xl min-w-0 flex-col gap-8 px-4 py-6 md:px-8">
            {archived && (
              <Callout
                role="status"
                tone="warning"
                icon={<ArchiveIcon />}
                title={ar.company.archivedBanner.title}
                description={ar.company.archivedBanner.description}
              />
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

const navLink = cn(
  'relative flex h-control items-center gap-3 rounded-md px-3 text-control text-sidebar-muted-foreground transition-colors duration-150 ease-out',
  'hover:bg-sidebar-hover hover:text-sidebar-foreground',
  'data-[status=active]:bg-sidebar-active data-[status=active]:font-medium data-[status=active]:text-sidebar-foreground',
  'before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:bg-sidebar-marker before:opacity-0 data-[status=active]:before:opacity-100',
);

/** The signed-in company's branding, and its registered name while the branding loads. */
interface Brand {
  branding: Branding | undefined;
  fallback: string;
}

function Sidebar({
  me,
  brand,
  onNavigate,
}: {
  me: Me | null | undefined;
  brand: Brand | undefined;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground [--ring:var(--sidebar-ring)]">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-sidebar-border px-5">
        {brand ? (
          <>
            <CompanyLogo
              src={logoUrl(brand.branding, '/company/branding/logo')}
              className="text-sidebar-marker"
              imageClassName="rounded-sm bg-sidebar-foreground p-0.5"
            />
            <span className="line-clamp-2 min-w-0 text-base leading-tight font-bold">
              <bdi>{displayName(brand.branding, brand.fallback)}</bdi>
            </span>
          </>
        ) : (
          <>
            <CompanyLogo className="text-sidebar-marker" />
            <span className="text-lg font-bold">{common.productName}</span>
          </>
        )}
      </div>
      {/* The links scroll under the fixed header on short screens and phones. */}
      <nav
        aria-label={t.navLabel}
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3"
      >
        {listedItems(me).map(({ to, label, icon: Icon, exact }) => (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            activeOptions={{ exact: exact ?? false }}
            className={navLink}
          >
            <Icon aria-hidden="true" className="size-icon" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function TopBar({ me, brand }: { me: Me | null | undefined; brand: Brand | undefined }) {
  const [navOpen, setNavOpen] = useState(false);
  const commands = useShellCommands(me);
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-border bg-surface px-4 md:px-8">
      <div className="flex shrink-0 items-center gap-2 md:hidden">
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetTrigger render={<Button variant="ghost" size="icon" aria-label={t.openNav} />}>
            <MenuIcon />
          </SheetTrigger>
          <SheetContent className="bg-sidebar">
            <SheetTitle className="sr-only">{t.navLabel}</SheetTitle>
            <Sidebar me={me} brand={brand} onNavigate={() => setNavOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {brand ? (
          <div className="flex min-w-0 items-center gap-2 md:hidden">
            <CompanyLogo
              src={logoUrl(brand.branding, '/company/branding/logo')}
              className="text-primary"
            />
            <span className="min-w-0 truncate font-bold text-foreground">
              <bdi>{displayName(brand.branding, brand.fallback)}</bdi>
            </span>
          </div>
        ) : (
          <CompanyLogo className="text-primary md:hidden" label={common.productName} />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <CommandPalette commands={commands} labels={ar.commandPalette} />
        <ThemeToggle labels={common.theme} />
        {me && <AccountMenu me={me} />}
      </div>
    </header>
  );
}

/** The palette's app-wide commands: the listed pages, the theme and the density. */
function useShellCommands(me: Me | null | undefined): PaletteCommand[] {
  const router = useRouter();
  return [
    ...listedItems(me).map(({ to, label }) => ({
      id: `go-${to}`,
      label,
      group: t.palette.navigation,
      icon: <ArrowLeftIcon />,
      run: () => void router.navigate({ to }),
    })),
    {
      id: 'dark',
      label: common.theme.toDark,
      group: t.palette.display,
      keywords: ['dark theme'],
      icon: <MoonIcon />,
      run: () => setTheme('dark'),
    },
    {
      id: 'light',
      label: common.theme.toLight,
      group: t.palette.display,
      keywords: ['light theme'],
      icon: <SunIcon />,
      run: () => setTheme('light'),
    },
    ...(['auto', 'compact', 'comfortable'] as const).map((option) => ({
      id: `density-${option}`,
      label: `${common.density.label}: ${common.density[option]}`,
      group: t.palette.display,
      keywords: ['density', option],
      icon: <RowsIcon />,
      run: () => setDensity(option),
    })),
  ];
}

/** The person's menu: their name and email, the settings and signing out. */
function AccountMenu({ me }: { me: Me }) {
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
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="min-w-0"
            aria-label={`${t.account.open}: ${me.person.name}`}
            loading={signOut.isPending}
          />
        }
      >
        <CircleUserIcon aria-hidden="true" />
        <span className="hidden max-w-40 truncate lg:inline">
          <bdi>{me.person.name}</bdi>
        </span>
        <ChevronDownIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-72">
        <DropdownMenuHeader>
          <bdi className="truncate font-medium text-foreground">{me.person.name}</bdi>
          <bdi dir="ltr" className="truncate text-xs text-muted-foreground">
            {me.person.email}
          </bdi>
        </DropdownMenuHeader>
        <DropdownMenuSeparator />
        {can(me, 'company.read') && (
          <DropdownMenuItem onClick={() => void navigate({ to: '/settings' })}>
            <SettingsIcon aria-hidden="true" />
            {t.account.settings}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => signOut.mutate()}>
          <LogOutIcon aria-hidden="true" />
          {t.account.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
