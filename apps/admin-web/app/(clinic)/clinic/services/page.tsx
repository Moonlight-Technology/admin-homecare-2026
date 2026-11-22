'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Search, Store } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { Pagination } from '@/components/data/pagination';
import { Alert, EmptyState, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { MODE_LABELS, StatusBadge } from '@/components/status/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/fields';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { Offering, OfferingPage } from '@/features/catalog/types';
import { useAuth } from '@/lib/auth/auth-provider';
import { canFacility } from '@/lib/auth/types';
import { api } from '@/lib/api/client';
import { formatDateTime, formatIDR } from '@/lib/format';

const LIMIT = 20;

/** "Homecare Rp175.000 + kunjungan Rp50.000 · On-site Rp150.000" */
function priceSummary(offering: Offering) {
  const enabled = offering.modes.filter((mode) => mode.enabled);
  if (!enabled.length) return 'Belum ada mode aktif';
  return enabled.map((mode) => `${MODE_LABELS[mode.mode] ?? mode.mode} ${formatIDR(mode.priceOverride ?? offering.basePrice)}${mode.visitFee ? ` + kunjungan ${formatIDR(mode.visitFee)}` : ''}`).join(' · ');
}

export default function ClinicServicesPage() {
  const { me } = useAuth();
  const canCreate = canFacility(me, 'offering:create');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());
  const offerings = useQuery({
    queryKey: ['clinic', 'offerings', deferredSearch, status, page],
    queryFn: () => api<OfferingPage>('/clinic/offerings', { query: { search: deferredSearch, status, page, limit: LIMIT } }),
    placeholderData: keepPreviousData,
  });
  const items = offerings.data?.items ?? [];
  const counts = offerings.data?.counts ?? {};
  const facility = offerings.data?.facility;
  const canPublishAtAll = facility?.verificationStatus === 'VERIFIED' && facility.operatingStatus === 'ACTIVE';

  return (
    <>
      <PageHeader title="Layanan" breadcrumbs={[{ label: 'Dashboard', href: '/clinic' }, { label: 'Layanan' }]} description="Layanan yang dapat dipesan pasien dari klinik Anda, beserta harga dan mode layanannya." actions={canCreate && <Button asChild><Link href="/clinic/services/new"><Plus />Tambah layanan</Link></Button>} />
      {facility && !canPublishAtAll && <Alert tone="warning" className="mb-5">{facility.verificationStatus !== 'VERIFIED' ? 'Klinik belum terverifikasi. Anda dapat menyiapkan draf, tetapi layanan baru dapat dipublikasikan setelah klinik terverifikasi.' : 'Klinik sedang tidak aktif, sehingga layanan tidak tampil untuk pasien.'}</Alert>}
      <Card>
        <div className="grid grid-cols-1 gap-3 border-b border-line p-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:p-5">
          <Input icon={Search} placeholder="Cari judul atau layanan master..." aria-label="Cari layanan" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          <Select aria-label="Status layanan" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">Semua (tanpa arsip)</option><option value="PUBLISHED">Dipublikasikan ({counts.PUBLISHED ?? 0})</option><option value="DRAFT">Draf ({counts.DRAFT ?? 0})</option><option value="UNPUBLISHED">Tidak tayang ({counts.UNPUBLISHED ?? 0})</option><option value="ARCHIVED">Diarsipkan ({counts.ARCHIVED ?? 0})</option>
          </Select>
        </div>
        {offerings.error ? <ErrorState message={offerings.error.message} onRetry={() => void offerings.refetch()} /> : offerings.isLoading ? <div className="space-y-3 p-5">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-16" />)}</div> : !items.length ? (
          <EmptyState icon={Store} title="Belum ada layanan" description="Tambahkan layanan dari katalog platform dan tentukan harga serta mode layanannya." action={canCreate && <Button asChild variant="secondary"><Link href="/clinic/services/new"><Plus />Tambah layanan</Link></Button>} />
        ) : (
          <ul className="divide-y divide-line">{items.map((item) => (
            <li key={item.id}>
              <Link href={`/clinic/services/${item.id}`} className="flex flex-col gap-2 px-4 py-4 hover:bg-app sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0 space-y-1">
                  <p className="font-semibold text-primary-700">{item.name}</p>
                  <p className="text-xs text-muted">{item.masterService.category.name} · {item.masterService.name} · {item.durationMinutes} menit</p>
                  <p className="text-sm text-ink">{priceSummary(item)}</p>
                </div>
                <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                  <StatusBadge status={item.status} />
                  <span className="text-xs text-muted">Diperbarui {formatDateTime(item.updatedAt)}</span>
                </div>
              </Link>
            </li>
          ))}</ul>
        )}
        <Pagination page={page} limit={LIMIT} total={offerings.data?.total ?? 0} onPageChange={setPage} />
      </Card>
    </>
  );
}
