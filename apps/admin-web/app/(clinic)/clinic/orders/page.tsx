'use client';

import { PageHeader } from '@/components/layout/page-header';
import { OrderList } from '@/features/orders/order-list';

export default function ClinicOrdersPage() {
  return (
    <>
      <PageHeader title="Order" breadcrumbs={[{ label: 'Dashboard', href: '/clinic' }, { label: 'Order' }]} description="Order yang menunggu persetujuan tampil dari jadwal kunjungan terdekat. Setujui atau tolak order secara utuh." />
      <OrderList endpoint="/clinic/orders" basePath="/clinic/orders" defaultStatus="PENDING_APPROVAL" />
    </>
  );
}
