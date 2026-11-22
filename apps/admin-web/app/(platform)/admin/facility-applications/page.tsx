'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Search } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { Pagination } from '@/components/data/pagination';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status/status-badge';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/fields';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { ApplicationRow } from '@/features/facilities/types';
import { api } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format';

type Page = { items: ApplicationRow[]; page: number; limit: number; total: number; counts: Record<string, number> };
const LIMIT = 20;

export default function FacilityApplicationsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('SUBMITTED');
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());
  const applications = useQuery({
    queryKey: ['facility-applications', deferredSearch, status, page],
    queryFn: () => api<Page>('/admin/facility-applications', { query: { search: deferredSearch, status, page, limit: LIMIT } }),
    placeholderData: keepPreviousData,
  });
  const items = applications.data?.items ?? [];

  return (
    <>
      <PageHeader title="Verifikasi klinik" breadcrumbs={[{ label: 'Dashboard', href: '/admin' }, { label: 'Verifikasi klinik' }]} description="Review profil dan dokumen pengajuan klinik, dimulai dari antrean terlama." />
      <Card>
        <div className="grid grid-cols-1 gap-3 border-b border-line p-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:p-5">
          <Input icon={Search} placeholder="Cari nama klinik..." aria-label="Cari klinik" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          <Select aria-label="Status pengajuan" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">Semua status</option><option value="SUBMITTED">Menunggu review</option><option value="UNDER_REVIEW">Sedang direview</option><option value="APPROVED">Disetujui</option><option value="REVISION_REQUIRED">Perlu revisi</option><option value="REJECTED">Ditolak</option>
          </Select>
        </div>
        {applications.error ? <ErrorState message={applications.error.message} onRetry={() => void applications.refetch()} /> : applications.isLoading ? <div className="space-y-3 p-5">{[0,1,2,3].map((item) => <Skeleton key={item} className="h-14" />)}</div> : !items.length ? <EmptyState icon={ClipboardCheck} title="Antrean kosong" description="Tidak ada pengajuan yang cocok dengan filter saat ini." /> : (
          <>
            <ul className="divide-y divide-line md:hidden">{items.map((item) => <li key={item.id}><Link href={`/admin/facility-applications/${item.id}`} className="block space-y-1 px-4 py-4 hover:bg-app"><div className="flex items-start justify-between gap-3"><p className="font-semibold text-ink">{item.facility.displayName}</p><StatusBadge status={item.status === 'APPROVED' ? 'VERIFIED' : item.status} /></div><p className="text-xs text-muted">{item.facility.facilityType.name} · Versi {item.version} · {formatDateTime(item.submittedAt)}</p></Link></li>)}</ul>
            <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead className="bg-app text-xs font-semibold uppercase tracking-wide text-muted"><tr><th className="px-5 py-3">Klinik</th><th className="px-5 py-3">Jenis</th><th className="px-5 py-3">Dikirim</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-line">{items.map((item) => <tr key={item.id} className="hover:bg-app/60"><td className="px-5 py-3"><Link href={`/admin/facility-applications/${item.id}`} className="font-semibold text-primary-700 hover:underline">{item.facility.displayName}</Link><span className="block text-xs text-muted">{item.facility.legalName} · v{item.version}</span></td><td className="px-5 py-3 text-muted">{item.facility.facilityType.name}</td><td className="whitespace-nowrap px-5 py-3 text-muted">{formatDateTime(item.submittedAt)}</td><td className="px-5 py-3"><StatusBadge status={item.status === 'APPROVED' ? 'VERIFIED' : item.status} /></td></tr>)}</tbody></table></div>
          </>
        )}
        <Pagination page={page} limit={LIMIT} total={applications.data?.total ?? 0} onPageChange={setPage} />
      </Card>
    </>
  );
}
