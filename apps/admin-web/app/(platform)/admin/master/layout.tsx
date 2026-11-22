'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { MASTER_RESOURCES } from '@/features/master-data/config';
import { cn } from '@/lib/cn';

const TABS = [...MASTER_RESOURCES.map((resource) => ({ href: `/admin/master/${resource.key}`, label: resource.title })), { href: '/admin/master/regions', label: 'Wilayah' }];

/** Master data area with its own tab bar; scrolls horizontally on narrow screens. */
export default function MasterLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <PageHeader title="Master data" breadcrumbs={[{ label: 'Dashboard', href: '/admin' }, { label: 'Master data' }]} description="Taksonomi dan data referensi yang dipakai klinik, nakes, layanan, dan order." />
      <nav aria-label="Jenis master data" className="-mx-4 mb-5 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="flex w-max gap-1.5 md:w-auto md:flex-wrap">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn('inline-flex min-h-10 items-center whitespace-nowrap rounded-full px-3.5 text-sm font-semibold transition-colors', active ? 'bg-primary-500 text-white' : 'bg-surface text-muted ring-1 ring-line hover:text-ink')}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {children}
    </>
  );
}
