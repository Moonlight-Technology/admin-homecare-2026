'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClipboardList, Search } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { Pagination } from '@/components/data/pagination';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { MODE_LABELS, StatusBadge } from '@/components/status/status-badge';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/fields';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api/client';
import { formatDateTime, formatIDR, formatRelative } from '@/lib/format';
import type { OrderPage } from './types';

const LIMIT = 20;

/** Order list shared by the clinic inbox and the platform view; `basePath` decides where rows link. */
export function OrderList({ endpoint, basePath, defaultStatus = '', showFacility = false }: { endpoint: string; basePath: string; defaultStatus?: string; showFacility?: boolean }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(defaultStatus);
  const [mode, setMode] = useState('');
  const [from, setFrom] = useState('');
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());
  const orders = useQuery({
    queryKey: [endpoint, deferredSearch, status, mode, from, page],
    queryFn: () => api<OrderPage>(endpoint, { query: { search: deferredSearch, status, mode, from, page, limit: LIMIT } }),
    placeholderData: keepPreviousData,
  });
  const items = orders.data?.items ?? [];
  const counts = orders.data?.counts ?? {};
  const reset = () => setPage(1);

  return (
    <Card>
      <div className="grid grid-cols-1 gap-3 border-b border-line p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-[minmax(0,1fr)_220px_160px_170px]">
        <Input icon={Search} placeholder="Cari kode order (NK-...)" aria-label="Cari kode order" value={search} onChange={(event) => { setSearch(event.target.value); reset(); }} />
        <Select aria-label="Status order" value={status} onChange={(event) => { setStatus(event.target.value); reset(); }}>
          <option value="">Semua status</option>
          <option value="PENDING_APPROVAL">Menunggu persetujuan ({counts.PENDING_APPROVAL ?? 0})</option>
          <option value="CONFIRMED">Dikonfirmasi ({counts.CONFIRMED ?? 0})</option>
          <option value="IN_PROGRESS">Dalam proses ({counts.IN_PROGRESS ?? 0})</option>
          <option value="COMPLETED">Selesai ({counts.COMPLETED ?? 0})</option>
          <option value="REJECTED">Ditolak ({counts.REJECTED ?? 0})</option>
          <option value="CANCELLED">Dibatalkan ({counts.CANCELLED ?? 0})</option>
          <option value="EXPIRED">Kedaluwarsa ({counts.EXPIRED ?? 0})</option>
          <option value="NO_SHOW">Tidak hadir ({counts.NO_SHOW ?? 0})</option>
        </Select>
        <Select aria-label="Mode" value={mode} onChange={(event) => { setMode(event.target.value); reset(); }}><option value="">Semua mode</option><option value="ON_SITE">On-site</option><option value="HOMECARE">Homecare</option></Select>
        <Input aria-label="Tanggal kunjungan mulai" type="date" value={from} onChange={(event) => { setFrom(event.target.value); reset(); }} />
      </div>
      {orders.error ? <ErrorState message={orders.error.message} onRetry={() => void orders.refetch()} /> : orders.isLoading ? <div className="space-y-3 p-5">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-16" />)}</div> : !items.length ? <EmptyState icon={ClipboardList} title="Tidak ada order" description="Belum ada order yang cocok dengan filter saat ini." /> : (
        <ul className="divide-y divide-line">{items.map((order) => (
          <li key={order.id}>
            <Link href={`${basePath}/${order.id}`} className="flex flex-col gap-2 px-4 py-4 hover:bg-app sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm font-semibold text-primary-700">{order.code}</span><StatusBadge status={order.status} />{['CONFIRMED', 'IN_PROGRESS'].includes(order.status) && order.assignmentStatus !== 'ASSIGNED' && <StatusBadge status={order.assignmentStatus} />}</div>
                <p className="text-sm text-ink">{formatDateTime(order.scheduledAt, order.timezone)} ({order.timezone}) · {MODE_LABELS[order.mode] ?? order.mode} · {order.patientName}{showFacility && order.facility && ` · ${order.facility.displayName}`}</p>
                <p className="truncate text-xs text-muted">{order.itemNames.join(', ')} · {order.durationMinutes} menit</p>
              </div>
              <div className="flex shrink-0 flex-col items-start gap-0.5 sm:items-end">
                <span className="text-sm font-semibold text-ink">{formatIDR(order.grandTotal)}</span>
                <span className="text-xs text-muted">dipesan {formatRelative(order.createdAt)}</span>
              </div>
            </Link>
          </li>
        ))}</ul>
      )}
      <Pagination page={page} limit={LIMIT} total={orders.data?.total ?? 0} onPageChange={setPage} />
    </Card>
  );
}
