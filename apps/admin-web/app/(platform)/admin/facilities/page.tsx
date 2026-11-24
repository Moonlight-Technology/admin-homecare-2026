'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { Pagination } from '@/components/data/pagination';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/fields';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useMasterOptions } from '@/features/facilities/api';
import type { Facility } from '@/features/facilities/types';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-provider';
import { canPlatform } from '@/lib/auth/types';

const LIMIT = 20;
type FacilityPage = { items: Facility[]; total: number };
const verificationLabels: Record<string, string> = { DRAFT: 'Draf', SUBMITTED: 'Menunggu review', UNDER_REVIEW: 'Sedang direview', VERIFIED: 'Terverifikasi', REVISION_REQUIRED: 'Perlu revisi', REJECTED: 'Ditolak' };

export default function FacilitiesPage() {
  const { me } = useAuth();
  const allowed = canPlatform(me, 'facility:read');
  const [search, setSearch] = useState('');
  const [verificationStatus, setVerificationStatus] = useState('');
  const [operatingStatus, setOperatingStatus] = useState('');
  const [facilityTypeId, setFacilityTypeId] = useState('');
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());
  const options = useMasterOptions();
  const facilities = useQuery({
    queryKey: ['admin-facilities', deferredSearch, verificationStatus, operatingStatus, facilityTypeId, page],
    queryFn: () => api<FacilityPage>('/admin/facilities', { query: { search: deferredSearch, verificationStatus, operatingStatus, facilityTypeId, page, limit: LIMIT } }),
    enabled: allowed,
    placeholderData: keepPreviousData,
  });
  const items = facilities.data?.items ?? [];

  if (!allowed) return <ErrorState message="Anda tidak memiliki izin melihat klinik." />;
  return (
    <>
      <PageHeader title="Klinik" breadcrumbs={[{ label: 'Dashboard', href: '/admin' }, { label: 'Klinik' }]} description="Kelola profil, pemilik, dan status operasional klinik. Verifikasi tetap melalui antrean review." actions={canPlatform(me, 'facility:create') && <Button asChild><Link href="/admin/facilities/new"><Plus />Tambah klinik</Link></Button>} />
      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
          <Input icon={Search} aria-label="Cari klinik" placeholder="Nama atau alamat klinik..." value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          <Select aria-label="Status verifikasi" value={verificationStatus} onChange={(event) => { setVerificationStatus(event.target.value); setPage(1); }}><option value="">Semua verifikasi</option>{Object.entries(verificationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
          <Select aria-label="Status operasional" value={operatingStatus} onChange={(event) => { setOperatingStatus(event.target.value); setPage(1); }}><option value="">Semua operasional</option><option value="ACTIVE">Aktif</option><option value="INACTIVE">Nonaktif</option><option value="SUSPENDED">Disuspend</option></Select>
          <Select aria-label="Jenis fasilitas" value={facilityTypeId} disabled={options.isLoading || options.isError} onChange={(event) => { setFacilityTypeId(event.target.value); setPage(1); }}><option value="">{options.isError ? 'Jenis gagal dimuat' : 'Semua jenis fasilitas'}</option>{options.data?.facilityTypes.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</Select>
        </div>
        {facilities.error ? <ErrorState message={facilities.error.message} onRetry={() => void facilities.refetch()} /> : facilities.isLoading ? <div className="space-y-3 p-5">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-16" />)}</div> : !items.length ? <EmptyState icon={Building2} title="Belum ada klinik" description="Tidak ada klinik yang sesuai dengan filter saat ini." /> : (
          <>
            <ul className="divide-y divide-line md:hidden">{items.map((item) => <li key={item.id}><Link href={`/admin/facilities/${item.id}`} className="block space-y-2 px-4 py-4 hover:bg-app"><p className="break-words font-semibold text-ink">{item.displayName}</p><p className="break-words text-xs text-muted">{item.facilityType.name} · {item.addressLine}</p><div className="flex flex-wrap gap-2"><StatusBadge status={item.verificationStatus} /><StatusBadge status={item.operatingStatus} /></div></Link></li>)}</ul>
            <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead className="bg-app text-xs uppercase text-muted"><tr><th className="px-5 py-3">Klinik</th><th className="px-5 py-3">Jenis</th><th className="px-5 py-3">Pemilik</th><th className="px-5 py-3">Verifikasi</th><th className="px-5 py-3">Operasional</th></tr></thead><tbody className="divide-y divide-line">{items.map((item) => <tr key={item.id} className="hover:bg-app/60"><td className="max-w-xs px-5 py-4"><Link href={`/admin/facilities/${item.id}`} className="break-words font-semibold text-primary-700 hover:underline">{item.displayName}</Link><p className="break-words text-xs text-muted">{item.legalName}</p></td><td className="px-5 py-4 text-muted">{item.facilityType.name}</td><td className="max-w-xs break-words px-5 py-4 text-muted">{item.owner?.name ?? 'Belum ada pemilik'}</td><td className="px-5 py-4"><StatusBadge status={item.verificationStatus} /></td><td className="px-5 py-4"><StatusBadge status={item.operatingStatus} /></td></tr>)}</tbody></table></div>
          </>
        )}
        <Pagination page={page} limit={LIMIT} total={facilities.data?.total ?? 0} onPageChange={setPage} />
      </Card>
    </>
  );
}
