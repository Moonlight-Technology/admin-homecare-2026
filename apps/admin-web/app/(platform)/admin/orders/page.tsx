'use client';

import { PageHeader } from '@/components/layout/page-header';
import { OrderList } from '@/features/orders/order-list';

export default function AdminOrdersPage() {
  return (
    <>
      <PageHeader title="Order" breadcrumbs={[{ label: 'Dashboard', href: '/admin' }, { label: 'Order' }]} description="Pantauan order seluruh klinik. Identitas pasien disamarkan; tindakan order dilakukan oleh klinik." />
      <OrderList endpoint="/admin/orders" basePath="/admin/orders" showFacility />
    </>
  );
}
