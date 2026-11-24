'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { FormField, Input } from '@/components/ui/input';
import { stripFieldPrefix } from '@/features/facilities/api';
import { ProfileFields } from '@/features/facilities/profile-fields';
import { emptyProfile, profilePayload, type Facility } from '@/features/facilities/types';
import { api, ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-provider';
import { canPlatform } from '@/lib/auth/types';

export default function NewFacilityPage() {
  const { me } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = useState(emptyProfile);
  const [owner, setOwner] = useState({ name: '', email: '' });
  const create = useMutation({
    mutationFn: () => api<Facility>('/admin/facilities', { method: 'POST', body: { facility: profilePayload(values), owner } }),
    onSuccess: (facility) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-facilities'] });
      queryClient.setQueryData(['admin-facility', facility.id], facility);
      router.replace(`/admin/facilities/${facility.id}`);
    },
  });
  const errors = create.error instanceof ApiError ? create.error.fieldErrors : {};
  const submit = (event: FormEvent) => { event.preventDefault(); if (!create.isPending) create.mutate(); };
  if (!canPlatform(me, 'facility:create')) return <ErrorState message="Anda tidak memiliki izin menambahkan klinik." />;
  return (
    <>
      <PageHeader title="Tambah klinik" breadcrumbs={[{ label: 'Klinik', href: '/admin/facilities' }, { label: 'Tambah klinik' }]} description="Buat klinik draf dan undang pemilik untuk mengaktifkan akun. Tidak ada password yang dikirim." />
      <form onSubmit={submit}>
        <Card><CardBody className="space-y-6">
          <Alert tone="info">Klinik baru berstatus draf dan nonaktif. Pemilik perlu melengkapi dokumen dan mengajukan verifikasi sebelum klinik dapat beroperasi.</Alert>
          {create.error && <Alert>{create.error.message}</Alert>}
          <fieldset disabled={create.isPending} className="space-y-4"><legend className="mb-2 text-sm font-semibold text-ink">Akun pemilik</legend>
            <FormField label="Nama pemilik" required error={errors['owner.name']?.[0]}>{(props) => <Input {...props} required minLength={2} maxLength={120} autoComplete="name" value={owner.name} onChange={(event) => setOwner((current) => ({ ...current, name: event.target.value }))} />}</FormField>
            <FormField label="Email pemilik" required error={errors['owner.email']?.[0]} hint="Gunakan email yang belum terdaftar. Undangan aktivasi ditujukan ke alamat ini.">{(props) => <Input {...props} required type="email" maxLength={254} autoComplete="email" value={owner.email} onChange={(event) => setOwner((current) => ({ ...current, email: event.target.value }))} />}</FormField>
          </fieldset>
          <ProfileFields values={values} onChange={(patch) => setValues((current) => ({ ...current, ...patch }))} errors={stripFieldPrefix(errors, 'facility.')} disabled={create.isPending} />
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-5"><Button asChild variant="secondary"><Link href="/admin/facilities">Batal</Link></Button><Button type="submit" loading={create.isPending}>Buat klinik & undang pemilik</Button></div>
        </CardBody></Card>
      </form>
    </>
  );
}
