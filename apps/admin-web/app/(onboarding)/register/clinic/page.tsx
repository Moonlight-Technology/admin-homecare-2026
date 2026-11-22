'use client';

import Link from 'next/link';
import { CheckCircle2, Lock, Mail, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Logo } from '@/components/brand/logo';
import { Alert } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { FormField, Input, PasswordInput } from '@/components/ui/input';
import { ProfileFields } from '@/features/facilities/profile-fields';
import { emptyProfile, profilePayload } from '@/features/facilities/types';
import { ApiError, publicPost } from '@/lib/api/client';

export default function ClinicRegistrationPage() {
  const [profile, setProfile] = useState(emptyProfile);
  const [owner, setOwner] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setMessage('');
    setSubmitting(true);
    try {
      const result = await publicPost<{ facilityId: string }>('/clinic-registration', { owner, facility: profilePayload(profile) });
      setFacilityId(result.facilityId);
    } catch (cause) {
      if (cause instanceof ApiError) {
        setErrors(cause.fieldErrors);
        setMessage(cause.message);
      } else setMessage('Pendaftaran gagal. Periksa koneksi lalu coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  if (facilityId) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-app px-4 py-10">
        <Card className="w-full max-w-lg text-center">
          <CardBody className="py-10">
            <CheckCircle2 className="mx-auto size-14 text-success" aria-hidden />
            <h1 className="mt-4 text-2xl font-bold text-ink">Klinik berhasil didaftarkan</h1>
            <p className="mt-2 text-sm text-muted">Masuk dengan akun pemilik untuk melengkapi dokumen dan mengirim pengajuan verifikasi.</p>
            <Button asChild className="mt-6"><Link href="/login?next=/clinic/verification">Masuk ke dashboard</Link></Button>
          </CardBody>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-app px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <Logo />
          <p className="text-sm text-muted">Sudah terdaftar? <Link href="/login" className="font-semibold text-primary-700">Masuk</Link></p>
        </div>
        <form onSubmit={submit} noValidate className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-ink">Daftarkan klinik</h1>
            <p className="mt-1 text-sm text-muted">Buat akun pemilik dan profil satu lokasi fisik klinik.</p>
          </div>
          {message && <Alert>{message}</Alert>}
          <Card>
            <CardHeader title="Akun pemilik" description="Akun ini menjadi administrator utama klinik." />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Nama pemilik" required error={errors['owner.name']?.[0]}>
                {(props) => <Input {...props} icon={UserRound} value={owner.name} onChange={(event) => setOwner((value) => ({ ...value, name: event.target.value }))} />}
              </FormField>
              <FormField label="Email pemilik" required error={errors['owner.email']?.[0]}>
                {(props) => <Input {...props} icon={Mail} type="email" autoComplete="email" value={owner.email} onChange={(event) => setOwner((value) => ({ ...value, email: event.target.value }))} />}
              </FormField>
              <div className="sm:col-span-2 sm:max-w-md">
                <FormField label="Password" required error={errors['owner.password']?.[0]} hint="Minimal 12 karakter.">
                  {(props) => <PasswordInput {...props} icon={Lock} autoComplete="new-password" value={owner.password} onChange={(event) => setOwner((value) => ({ ...value, password: event.target.value }))} />}
                </FormField>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Profil klinik" description="Data ini dapat dilengkapi kembali sebelum pengajuan dikirim." />
            <CardBody><ProfileFields values={profile} onChange={(patch) => setProfile((value) => ({ ...value, ...patch }))} errors={Object.fromEntries(Object.entries(errors).filter(([key]) => key.startsWith('facility.')).map(([key, value]) => [key.slice(9), value]))} /></CardBody>
          </Card>
          <div className="flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
            <p className="text-xs text-muted">Dengan mendaftar, Anda menyatakan data yang diberikan benar.</p>
            <Button type="submit" loading={submitting}>Daftarkan klinik</Button>
          </div>
        </form>
      </div>
    </main>
  );
}
