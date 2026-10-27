import { Link, type LinkProps, useRouter } from '@tanstack/react-router';
import { ar } from '@vertex-mizan/i18n';
import {
  Button,
  CommandPalette,
  cn,
  type PaletteCommand,
  PoweredBy,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  setDensity,
  setTheme,
  ThemeToggle,
  VertexMizanMark,
} from '@vertex-mizan/ui';
import {
  ArrowLeftIcon,
  HouseIcon,
  type LucideIcon,
  MenuIcon,
  MoonIcon,
  RowsIcon,
  ShieldCheckIcon,
  SunIcon,
  SwatchBookIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';

const t = ar.shell;
const { common } = ar;

interface NavItem {
  to: NonNullable<LinkProps['to']>;
  label: string;
  icon: LucideIcon;
  /** Active only on this exact path; otherwise also on its sub-pages. */
  exact?: boolean;
  /** Lists the item only when this holds; the page stays reachable. */
  show?: () => boolean;
}

const navItems: NavItem[] = [
  { to: '/', label: t.nav.home, icon: HouseIcon, exact: true },
  { to: '/account/security', label: ar.auth.nav, icon: ShieldCheckIcon },
  // A developer gallery (and the screenshot tests' page): listed in development only.
  {
    to: '/design-system',
    label: t.nav.designSystem,
    icon: SwatchBookIcon,
    exact: true,
    show: () => import.meta.env.DEV,
  },
];

const listedItems = () => navItems.filter((item) => !item.show || item.show());

/** Vertex Green navigation, a gold marker on the active page (brand/identity.md §2, §7). */
export function AppShell({ children }: { children: ReactNode }) {
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
        <Sidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          <div className="mx-auto flex max-w-6xl min-w-0 flex-col gap-8 px-4 py-6 md:px-8">
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

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full w-full flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground [--ring:var(--sidebar-ring)]">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-sidebar-border px-5">
        <VertexMizanMark className="w-7 text-sidebar-marker" />
        <span className="text-lg font-bold">{common.productName}</span>
      </div>
      {/* The links scroll under the fixed header on short screens and phones. */}
      <nav
        aria-label={t.navLabel}
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3"
      >
        {listedItems().map(({ to, label, icon: Icon, exact }) => (
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
      <div className="border-t border-sidebar-border p-4">
        {/* The sidebar's own colors: the mark in gold, as in its header. */}
        <PoweredBy
          label={common.poweredBy}
          className="text-sidebar-muted-foreground [&_svg]:text-sidebar-marker"
        />
      </div>
    </div>
  );
}

function TopBar() {
  const [navOpen, setNavOpen] = useState(false);
  const commands = useShellCommands();
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-border bg-surface px-4 md:px-8">
      <div className="flex items-center gap-2 md:invisible">
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetTrigger render={<Button variant="ghost" size="icon" aria-label={t.openNav} />}>
            <MenuIcon />
          </SheetTrigger>
          <SheetContent className="bg-sidebar">
            <SheetTitle className="sr-only">{t.navLabel}</SheetTitle>
            <Sidebar onNavigate={() => setNavOpen(false)} />
          </SheetContent>
        </Sheet>
        <VertexMizanMark className="w-6 text-primary" label={common.productName} />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <CommandPalette commands={commands} labels={ar.commandPalette} />
        <ThemeToggle labels={common.theme} />
      </div>
    </header>
  );
}

/** The palette's app-wide commands: the listed pages, the theme and the density. */
function useShellCommands(): PaletteCommand[] {
  const router = useRouter();
  return [
    ...listedItems().map(({ to, label }) => ({
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
