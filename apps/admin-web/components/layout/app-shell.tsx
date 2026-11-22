'use client';

import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, LogOut, Menu, PanelLeftClose, PanelLeftOpen, ShieldAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';
import { Alert, FullPageLoader } from '@/components/feedback/states';
import { StatusBadge } from '@/components/status/status-badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet } from '@/components/ui/sheet';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAuth } from '@/lib/auth/auth-provider';
import { canFacility, canPlatform, homePath, type Me } from '@/lib/auth/types';
import { cn } from '@/lib/cn';
import { DESKTOP_QUERY, useMediaQuery } from '@/lib/use-media-query';
import { CLINIC_NAV, PLATFORM_NAV, type NavItem } from './navigation';
import { SidebarNav } from './sidebar-nav';

type Area = 'platform' | 'clinic';

const AREA: Record<Area, { title: string; nav: NavItem[]; allowed: (me: Me) => boolean; can: (me: Me | null, permission: string) => boolean }> = {
  platform: { title: 'Platform Admin', nav: PLATFORM_NAV, allowed: (me) => Boolean(me.platform), can: canPlatform },
  clinic: { title: 'Klinik Admin', nav: CLINIC_NAV, allowed: (me) => Boolean(me.facility), can: canFacility },
};

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');

/**
 * One route-aware shell for both areas (DESIGN.md §4): 248px sidebar on desktop (collapsible to 72px),
 * an icon rail on tablet, and a drawer on mobile. Hiding links is never the authorization; the API checks every call.
 */
export function AppShell({ area, children }: { area: Area; children: ReactNode }) {
  const { status, me, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const config = AREA[area];

  useEffect(() => {
    if (status === 'signed-out') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (status === 'signed-in' && me && !config.allowed(me)) router.replace(homePath(me));
  }, [status, me, config, router, pathname]);

  if (status !== 'signed-in' || !me || !config.allowed(me)) return <FullPageLoader />;

  const items = config.nav.filter((item) => !item.permission || config.can(me, item.permission));
  const facility = area === 'clinic' ? me.memberships.find((membership) => membership.facility?.id === me.facility?.facilityId)?.facility ?? null : null;
  const roleName = me.memberships.find((membership) => (area === 'platform' ? membership.scopeType === 'PLATFORM' : membership.facility?.id === facility?.id))?.role.name ?? config.title;
  const rail = !isDesktop || collapsed;
  const limited = facility && (facility.verificationStatus !== 'VERIFIED' || facility.operatingStatus !== 'ACTIVE');

  return (
    <TooltipProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow">Lewati ke konten</a>
      <div className="flex min-h-dvh">
        <aside className={cn('sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface transition-[width] md:flex', rail ? 'w-[72px]' : 'w-[248px]')}>
          <div className={cn('flex h-16 items-center border-b border-line', rail ? 'justify-center' : 'px-5')}>
            <Logo compact={rail} />
          </div>
          <div className="flex-1 overflow-y-auto">
            <SidebarNav items={items} rail={rail} />
          </div>
        </aside>

        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen} title="Menu navigasi">
          <div className="flex h-16 items-center border-b border-line px-5"><Logo /></div>
          <div className="flex-1 overflow-y-auto"><SidebarNav items={items} rail={false} onNavigate={() => setDrawerOpen(false)} /></div>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur md:px-6">
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Buka menu" onClick={() => setDrawerOpen(true)}><Menu /></Button>
            {isDesktop && (
              <Button variant="ghost" size="icon" aria-label={collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'} onClick={() => setCollapsed((value) => !value)}>
                {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </Button>
            )}
            <div className="min-w-0 flex-1">
              {facility ? (
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-semibold text-ink">{facility.displayName}</p>
                  <span className="hidden sm:inline-flex"><StatusBadge status={facility.verificationStatus} /></span>
                </div>
              ) : (
                <p className="truncate text-sm font-semibold text-ink md:hidden">{config.title}</p>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex min-h-11 items-center gap-2 rounded-[var(--radius-input)] px-1.5 hover:bg-app" aria-label="Menu akun">
                  <span className="flex size-9 items-center justify-center rounded-full bg-primary-500 text-sm font-semibold text-white">{initials(me.user.name)}</span>
                  <span className="hidden text-left leading-tight lg:block">
                    <span className="block text-sm font-semibold text-ink">{me.user.name}</span>
                    <span className="block text-xs text-muted">{roleName}</span>
                  </span>
                  <ChevronDown className="hidden size-4 text-muted lg:block" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>
                  <p className="text-sm font-semibold text-ink">{me.user.name}</p>
                  <p className="text-xs text-muted">{me.user.email}</p>
                  <p className="mt-1 text-xs text-muted">{roleName}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void signOut()}><LogOut /> Keluar</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 md:px-6 desk:px-8 desk:py-7">
            {limited && (
              <Alert tone="warning" className="mb-5 flex items-start gap-2">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Klinik belum terverifikasi atau belum aktif. Layanan belum bisa dipublikasikan dan klinik belum bisa menerima booking baru
                  sampai verifikasi selesai.
                </span>
              </Alert>
            )}
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
