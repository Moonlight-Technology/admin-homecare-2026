'use client';

import { CalendarCheck2, CalendarClock, ClipboardList, Store, UserRoundX } from 'lucide-react';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { KpiCard } from '@/components/layout/kpi-card';
import { PageHeader } from '@/components/layout/page-header';
import { MODE_LABELS, StatusBadge } from '@/components/status/status-badge';
import { Card, CardHeader } from '@/components/ui/card';
import { useClinicSummary } from '@/features/dashboard/api';
import { QueueList } from '@/features/dashboard/queue-list';
import { formatDateTime, formatRelative } from '@/lib/format';

/** Clinic dashboard (DESIGN.md §6.3): the approval queue comes before anything secondary, on every width. */
export default function ClinicDashboardPage() {
  const summary = useClinicSummary();
  const data = summary.data;

  return (
    <>
      <PageHeader title="Dashboard klinik" description="Ringkasan aktivitas dan antrean persetujuan order klinik Anda." />

      {summary.error ? (
        <Card><ErrorState message={summary.error.message} onRetry={() => void summary.refetch()} /></Card>
      ) : (
        <>
          <Card className="mb-4 md:mb-6">
            <CardHeader title="Menunggu persetujuan" description="Setiap order disetujui atau ditolak utuh; tidak ada persetujuan sebagian." />
            {!summary.isLoading && !data?.pendingQueue.length ? (
              <EmptyState icon={ClipboardList} title="Tidak ada order yang menunggu" description="Order baru dari pelanggan akan muncul di sini." />
            ) : (
              <QueueList
                loading={summary.isLoading}
                rows={(data?.pendingQueue ?? []).map((order) => ({
                  key: order.id,
                  icon: CalendarClock,
                  title: order.code,
                  subtitle: `${MODE_LABELS[order.mode] ?? order.mode} · ${order.itemCount} layanan · Kunjungan ${formatDateTime(order.scheduledAt)}`,
                  status: <StatusBadge status={order.status} />,
                  meta: `Masuk ${formatRelative(order.createdAt)}`,
                }))}
              />
            )}
          </Card>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 desk:grid-cols-4 md:gap-4">
            <KpiCard label="Order menunggu persetujuan" value={data?.kpis.pendingApproval} icon={ClipboardList} tone="warning" loading={summary.isLoading} />
            <KpiCard
              label="Kunjungan hari ini"
              hint={data ? `${data.kpis.todayConfirmed} terkonfirmasi · ${data.kpis.todayInProgress} dalam proses` : undefined}
              value={data ? data.kpis.todayConfirmed + data.kpis.todayInProgress : undefined}
              icon={CalendarCheck2}
              tone="info"
              loading={summary.isLoading}
            />
            <KpiCard label="Layanan aktif" hint="Dipublikasikan" value={data?.kpis.activeOfferings} icon={Store} tone="success" loading={summary.isLoading} />
            <KpiCard label="Kunjungan belum ditugaskan" hint="Order aktif tanpa nakes lengkap" value={data?.kpis.unassignedVisits} icon={UserRoundX} loading={summary.isLoading} />
          </div>
        </>
      )}
    </>
  );
}
