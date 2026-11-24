'use client';

import { AlertTriangle, Building2, CalendarClock, ClipboardCheck, ClipboardList, Stethoscope } from 'lucide-react';
import Link from 'next/link';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { KpiCard } from '@/components/layout/kpi-card';
import { PageHeader } from '@/components/layout/page-header';
import { MODE_LABELS, StatusBadge } from '@/components/status/status-badge';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type OrderExceptionReason, usePlatformSummary } from '@/features/dashboard/api';
import { QueueList } from '@/features/dashboard/queue-list';
import { useAuth } from '@/lib/auth/auth-provider';
import { formatDateTime, formatRelative } from '@/lib/format';

/** Facts from status and schedule only; no SLA is implied (spec §14). */
const EXCEPTION_LABELS: Record<OrderExceptionReason, string> = {
  PENDING_PAST_SCHEDULE: 'Jadwal lewat, belum disetujui',
  NOT_STARTED_PAST_SCHEDULE: 'Jadwal lewat, belum dimulai',
  UNASSIGNED_SOON: 'Nakes belum lengkap (< 24 jam)',
};

/**
 * Platform dashboard (DESIGN.md §6.2): actionable queues first. No charts yet: there is no authorised aggregate
 * endpoint for trends, and fabricated figures are not allowed.
 */
export default function PlatformDashboardPage() {
  const { me } = useAuth();
  const summary = usePlatformSummary();
  const data = summary.data;

  return (
    <>
      <PageHeader title={`Halo, ${me?.user.name ?? 'Admin'}`} description="Ringkasan operasional dan antrean yang membutuhkan tindakan." />

      {summary.error ? (
        <Card><ErrorState message={summary.error.message} onRetry={() => void summary.refetch()} /></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 desk:grid-cols-4 md:gap-4">
            <KpiCard label="Klinik aktif" hint="Terverifikasi dan aktif" value={data?.kpis.activeFacilities} icon={Building2} tone="success" loading={summary.isLoading} />
            <KpiCard label="Review klinik" hint="Menunggu atau sedang direview" value={data?.kpis.pendingFacilityReviews} icon={ClipboardCheck} tone="warning" loading={summary.isLoading} />
            <KpiCard label="Review nakes" hint="Menunggu atau sedang direview" value={data?.kpis.pendingPractitionerReviews} icon={Stethoscope} tone="info" loading={summary.isLoading} />
            <KpiCard label="Order menunggu persetujuan" hint={data ? `${data.kpis.openOrders} order aktif` : undefined} value={data?.kpis.pendingOrderApprovals} icon={ClipboardList} loading={summary.isLoading} />
          </div>

          <Card className="mt-4 md:mt-6">
            <CardHeader
              title={`Perlu perhatian (${data?.exceptions.total ?? 0})`}
              description={data
                ? `${data.exceptions.counts.pendingPastSchedule} belum disetujui · ${data.exceptions.counts.notStartedPastSchedule} belum dimulai · ${data.exceptions.counts.unassignedSoon} nakes belum lengkap. Jadwal terdekat di atas.`
                : 'Order yang jadwalnya lewat atau segera tiba tanpa nakes lengkap.'}
            />
            {!summary.isLoading && !data?.exceptions.orders.length ? (
              <EmptyState icon={AlertTriangle} title="Tidak ada order bermasalah" description="Order yang jadwalnya lewat atau belum ada nakesnya akan muncul di sini." />
            ) : (
              <QueueList
                loading={summary.isLoading}
                rows={(data?.exceptions.orders ?? []).map((order) => ({
                  key: order.id,
                  icon: AlertTriangle,
                  title: <Link href={`/admin/orders/${order.id}`} className="hover:text-primary-700 hover:underline">{order.code}</Link>,
                  subtitle: [order.facilityName, MODE_LABELS[order.mode] ?? order.mode, `Kunjungan ${formatDateTime(order.scheduledAt)}`].filter(Boolean).join(' · '),
                  status: (
                    <>
                      {order.reasons.map((reason) => <Badge key={reason} tone={reason === 'UNASSIGNED_SOON' ? 'warning' : 'danger'}><AlertTriangle aria-hidden />{EXCEPTION_LABELS[reason]}</Badge>)}
                      <StatusBadge status={order.status} />
                    </>
                  ),
                }))}
              />
            )}
          </Card>

          <div className="mt-4 grid grid-cols-1 gap-4 md:mt-6 desk:grid-cols-2">
            <Card>
              <Tabs defaultValue="facility">
                <CardHeader
                  title="Antrean verifikasi"
                  description="Yang paling lama menunggu tampil di atas."
                  action={
                    <TabsList>
                      <TabsTrigger value="facility">Klinik ({data?.kpis.pendingFacilityReviews ?? 0})</TabsTrigger>
                      <TabsTrigger value="practitioner">Nakes ({data?.kpis.pendingPractitionerReviews ?? 0})</TabsTrigger>
                    </TabsList>
                  }
                />
                <TabsContent value="facility">
                  {!summary.isLoading && !data?.facilityQueue.length ? (
                    <EmptyState icon={ClipboardCheck} title="Tidak ada pengajuan klinik" description="Pengajuan baru akan muncul di sini." />
                  ) : (
                    <QueueList
                      loading={summary.isLoading}
                      rows={(data?.facilityQueue ?? []).map((facility) => ({
                        key: facility.id,
                        icon: Building2,
                        title: facility.displayName,
                        status: <StatusBadge status={facility.verificationStatus} />,
                        meta: formatRelative(facility.updatedAt),
                      }))}
                    />
                  )}
                </TabsContent>
                <TabsContent value="practitioner">
                  {!summary.isLoading && !data?.practitionerQueue.length ? (
                    <EmptyState icon={Stethoscope} title="Tidak ada pengajuan nakes" description="Pengajuan baru akan muncul di sini." />
                  ) : (
                    <QueueList
                      loading={summary.isLoading}
                      rows={(data?.practitionerQueue ?? []).map((practitioner) => ({
                        key: practitioner.id,
                        icon: Stethoscope,
                        title: <Link href={`/admin/practitioners/${practitioner.id}`} className="hover:text-primary-700 hover:underline">{practitioner.fullName}</Link>,
                        subtitle: practitioner.practitionerType.name,
                        status: <StatusBadge status={practitioner.verificationStatus} />,
                        meta: formatRelative(practitioner.updatedAt),
                      }))}
                    />
                  )}
                </TabsContent>
              </Tabs>
            </Card>

            <Card>
              <CardHeader title="Order terbaru" description="Pemantauan saja; data pasien tidak ditampilkan di dashboard." />
              {!summary.isLoading && !data?.recentOrders.length ? (
                <EmptyState icon={ClipboardList} title="Belum ada order" description="Order dari aplikasi pelanggan akan muncul di sini." />
              ) : (
                <QueueList
                  loading={summary.isLoading}
                  rows={(data?.recentOrders ?? []).map((order) => ({
                    key: order.id,
                    icon: CalendarClock,
                    title: order.code,
                    subtitle: [order.facilityName, MODE_LABELS[order.mode] ?? order.mode, `${order.itemCount} layanan`, formatDateTime(order.scheduledAt)].filter(Boolean).join(' · '),
                    status: <StatusBadge status={order.status} />,
                  }))}
                />
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
