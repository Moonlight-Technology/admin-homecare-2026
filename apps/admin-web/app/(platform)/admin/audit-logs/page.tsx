'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ScrollText, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format';

type AuditLog = {
  id: string;
  event: string;
  entityType: string;
  entityId: string | null;
  scope: string;
  ip: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
};
type Page<T> = { items: T[]; page: number; limit: number; total: number };

const LIMIT = 20;
const actorLabel = (log: AuditLog) => (log.actor ? log.actor.name : log.scope === 'PUBLIC' ? 'Publik' : 'Sistem');
const entityLabel = (log: AuditLog) => `${log.entityType}${log.entityId ? ` · ${log.entityId.slice(0, 8)}` : ''}`;

/** `/admin/audit-logs` (spec §4): server-side search, date range, and pagination; payloads are redacted by the API. */
export default function AuditLogsPage() {
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());

  const logs = useQuery({
    queryKey: ['audit-logs', deferredSearch, from, to, page],
    queryFn: () =>
      api<Page<AuditLog>>('/admin/audit-logs', {
        query: { search: deferredSearch, from: from ? `${from}T00:00:00+07:00` : undefined, to: to ? `${to}T23:59:59+07:00` : undefined, page, limit: LIMIT },
      }),
    placeholderData: keepPreviousData,
  });
  const items = logs.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((logs.data?.total ?? 0) / LIMIT));
  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setPage(1); };

  return (
    <>
      <PageHeader title="Audit log" breadcrumbs={[{ label: 'Dashboard', href: '/admin' }, { label: 'Audit log' }]} description="Riwayat aksi sensitif: login, verifikasi, perubahan peran, persetujuan order, dan lainnya." />
      <Card>
        <div className="grid grid-cols-1 gap-3 border-b border-line p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:p-5">
          <Input icon={Search} aria-label="Cari audit log" placeholder="Cari event, entitas, atau ID..." value={search} onChange={(event) => resetPage(setSearch)(event.target.value)} />
          <Input type="date" aria-label="Dari tanggal" value={from} onChange={(event) => resetPage(setFrom)(event.target.value)} />
          <Input type="date" aria-label="Sampai tanggal" value={to} onChange={(event) => resetPage(setTo)(event.target.value)} />
        </div>

        {logs.error ? (
          <ErrorState message={logs.error.message} onRetry={() => void logs.refetch()} />
        ) : logs.isLoading ? (
          <div className="space-y-3 p-5">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-10 w-full" />)}</div>
        ) : !items.length ? (
          <EmptyState icon={ScrollText} title="Belum ada aktivitas" description="Tidak ada audit log yang cocok dengan filter." />
        ) : (
          <>
            {/* Mobile: record cards instead of a squeezed table. */}
            <ul className="divide-y divide-line md:hidden">
              {items.map((log) => (
                <li key={log.id} className="space-y-1 px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-sm font-semibold text-ink [overflow-wrap:anywhere]">{log.event}</p>
                    <span className="whitespace-nowrap text-xs text-muted">{formatDateTime(log.createdAt)}</span>
                  </div>
                  <p className="text-xs text-muted">{actorLabel(log)} · {entityLabel(log)}</p>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-app text-xs font-semibold uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-5 py-3">Waktu</th>
                    <th scope="col" className="px-5 py-3">Event</th>
                    <th scope="col" className="px-5 py-3">Pelaku</th>
                    <th scope="col" className="px-5 py-3">Entitas</th>
                    <th scope="col" className="px-5 py-3">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items.map((log) => (
                    <tr key={log.id} className="hover:bg-app/60">
                      <td className="whitespace-nowrap px-5 py-3 text-muted">{formatDateTime(log.createdAt)}</td>
                      <td className="px-5 py-3 font-medium text-ink">{log.event}</td>
                      <td className="px-5 py-3 text-ink">{actorLabel(log)}{log.actor && <span className="block text-xs text-muted">{log.actor.email}</span>}</td>
                      <td className="px-5 py-3 text-muted">{entityLabel(log)}</td>
                      <td className="px-5 py-3 text-muted">{log.ip ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted sm:px-5">
          <span>{logs.data?.total ?? 0} entri</span>
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="icon" aria-label="Halaman sebelumnya" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft /></Button>
            <span className="min-w-16 text-center" aria-live="polite">{page} / {totalPages}</span>
            <Button variant="secondary" size="icon" aria-label="Halaman berikutnya" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}><ChevronRight /></Button>
          </div>
        </div>
      </Card>
    </>
  );
}
