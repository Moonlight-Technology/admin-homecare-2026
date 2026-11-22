'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { OfferingForm } from '@/features/catalog/offering-form';
import { emptyOffering, offeringPayload, type Offering, type OfferingValues } from '@/features/catalog/types';
import { api, ApiError } from '@/lib/api/client';

export default function NewServicePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<OfferingValues>(emptyOffering);
  const create = useMutation({
    mutationFn: () => api<Offering>('/clinic/offerings', { method: 'POST', body: offeringPayload(values, true) }),
    onSuccess: (offering) => { void queryClient.invalidateQueries({ queryKey: ['clinic', 'offerings'] }); router.replace(`/clinic/services/${offering.id}`); },
  });
  const errors = create.error instanceof ApiError ? create.error.fieldErrors : {};

  return (
    <form onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
      <PageHeader title="Tambah layanan" breadcrumbs={[{ label: 'Layanan', href: '/clinic/services' }, { label: 'Tambah' }]} description="Layanan disimpan sebagai draf. Publikasikan setelah semuanya siap." actions={<Button type="submit" loading={create.isPending}><Save />Simpan draf</Button>} />
      {create.error && <Alert className="mb-5">{create.error.message}</Alert>}
      <OfferingForm values={values} onChange={(patch) => setValues((current) => ({ ...current, ...patch }))} errors={errors} />
    </form>
  );
}
