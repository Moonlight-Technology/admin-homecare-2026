'use client';

import { Suspense } from 'react';
import { RegionsPage } from '@/features/master-data/regions-page';

export default function RegionsRoute() {
  return (
    <Suspense>
      <RegionsPage />
    </Suspense>
  );
}
