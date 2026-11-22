'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ProfileFields } from '@/features/facilities/profile-fields';
import { emptyProfile, profileFromFacility, profilePayload, type Facility, type ProfileValues } from '@/features/facilities/types';
import { api, ApiError } from '@/lib/api/client';

export default function ClinicProfilePage() {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<ProfileValues>(emptyProfile);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState(false);
  const profile = useQuery({ queryKey: ['clinic', 'profile'], queryFn: () => api<Facility>('/clinic/profile') });
  useEffect(() => { if (profile.data) setValues(profileFromFacility(profile.data)); }, [profile.data]);

  const update = useMutation({
    mutationFn: () => api<Facility>('/clinic/profile', { method: 'PATCH', body: profilePayload(values) }),
    onSuccess: (facility) => {
      queryClient.setQueryData(['clinic', 'profile'], facility);
      void queryClient.invalidateQueries({ queryKey: ['clinic', 'verification'] });
      setErrors({});
      setSaved(true);
    },
    onError: (cause) => setErrors(cause instanceof ApiError ? cause.fieldErrors : {}),
  });

  const locked = profile.data?.verificationStatus === 'VERIFIED' ? (['legalName', 'facilityTypeId', 'clinicClassId'] as Array<keyof ProfileValues>) : [];
  const frozen = ['SUBMITTED', 'UNDER_REVIEW'].includes(profile.data?.verificationStatus ?? '');
  const submit = (event: FormEvent) => { event.preventDefault(); setSaved(false); update.mutate(); };

  return (
    <>
      <PageHeader title="Profil klinik" breadcrumbs={[{ label: 'Dashboard', href: '/clinic' }, { label: 'Profil klinik' }]} description="Kelola identitas, klasifikasi, kontak, dan alamat lokasi klinik." />
      {profile.error ? <Card><ErrorState message={profile.error.message} onRetry={() => void profile.refetch()} /></Card> : profile.isLoading ? <Card><CardBody className="space-y-3">{[0,1,2,3,4].map((item) => <Skeleton key={item} className="h-11" />)}</CardBody></Card> : (
        <form onSubmit={submit}>
          <Card>
            <CardBody className="space-y-5">
              {frozen && <Alert tone="warning">Profil dikunci sementara karena pengajuan sedang direview.</Alert>}
              {saved && <Alert tone="success">Profil klinik berhasil disimpan.</Alert>}
              {update.error && <Alert>{update.error.message}</Alert>}
              <ProfileFields values={values} onChange={(patch) => setValues((current) => ({ ...current, ...patch }))} errors={errors} locked={locked} disabled={frozen} />
              <div className="flex justify-end border-t border-line pt-5"><Button type="submit" loading={update.isPending} disabled={frozen}><Save />Simpan perubahan</Button></div>
            </CardBody>
          </Card>
        </form>
      )}
    </>
  );
}
