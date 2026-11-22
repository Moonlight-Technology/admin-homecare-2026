'use client';

import { notFound, useParams } from 'next/navigation';
import { Suspense } from 'react';
import { findMasterResource } from '@/features/master-data/config';
import { MasterResourcePage } from '@/features/master-data/master-resource-page';

export default function MasterResourceRoute() {
  const { resource } = useParams<{ resource: string }>();
  const config = findMasterResource(resource);
  if (!config) notFound();
  return (
    <Suspense>
      <MasterResourcePage key={config.key} config={config} />
    </Suspense>
  );
}
