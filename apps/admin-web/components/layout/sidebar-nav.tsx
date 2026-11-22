'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import type { NavItem } from './navigation';

const isActive = (pathname: string, href: string) => (href === '/admin' || href === '/clinic' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

/** Shared by the desktop sidebar, the tablet icon rail, and the mobile drawer. */
export function SidebarNav({ items, rail, onNavigate }: { items: NavItem[]; rail: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Menu utama" className="flex flex-col gap-1 p-3">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.ready && isActive(pathname, item.href);
        const content = (
          <>
            <Icon className="size-5 shrink-0" aria-hidden />
            <span className={cn('truncate', rail && 'sr-only')}>
              {item.label}
              {!item.ready && <span className="sr-only"> (segera tersedia)</span>}
            </span>
          </>
        );
        const className = cn(
          'flex min-h-11 items-center gap-3 rounded-[var(--radius-input)] px-3 text-sm font-medium transition-colors',
          rail && 'justify-center px-0',
          active ? 'bg-primary-50 text-primary-700' : item.ready ? 'text-muted hover:bg-app hover:text-ink' : 'cursor-not-allowed text-muted/60',
        );
        return (
          <Tooltip key={item.href} label={item.ready ? item.label : `${item.label} (segera)`} disabled={!rail}>
            {item.ready ? (
              <Link href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={className}>{content}</Link>
            ) : (
              <span aria-disabled="true" title={rail ? undefined : `${item.label} segera tersedia`} className={className} tabIndex={rail ? 0 : undefined}>{content}</span>
            )}
          </Tooltip>
        );
      })}
    </nav>
  );
}
