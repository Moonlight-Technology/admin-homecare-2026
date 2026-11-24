'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, ErrorState } from '@/components/feedback/states';
import { StatusBadge } from '@/components/status/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/fields';
import { FormField, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-provider';
import { canPlatform } from '@/lib/auth/types';
import { formatDateTime } from '@/lib/format';
import { ROLE_LABELS, type PlatformRole, type PlatformUser } from './types';

export function UserDialog({ user, onClose, onSaved }: { user: PlatformUser | null; onClose: () => void; onSaved: (message: string) => void }) {
  const { me, reload } = useAuth();
  const client = useQueryClient();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState('');
  const [roleCode, setRoleCode] = useState<PlatformRole>('PLATFORM_OPERATOR');
  const isSuper = Boolean(me?.platform?.roles.includes('PLATFORM_SUPER_ADMIN'));
  const targetSuper = user?.memberships.some((entry) => entry.role.code === 'PLATFORM_SUPER_ADMIN');
  const canManage = canPlatform(me, 'platform-user:manage') && (!targetSuper || isSuper);
  const self = user?.id === me?.user.id;
  const detail = useQuery({ queryKey: ['admin-user', user?.id], queryFn: () => api<PlatformUser>(`/admin/users/${user!.id}`), enabled: Boolean(user) });
  useEffect(() => {
    if (detail.data) {
      setName(detail.data.name);
      const code = detail.data.memberships[0]?.role.code;
      setRoleCode(code === 'PLATFORM_SUPER_ADMIN' ? code : 'PLATFORM_OPERATOR');
    }
  }, [detail.data]);
  const save = useMutation({
    mutationFn: () => api<PlatformUser>(user ? `/admin/users/${user.id}` : '/admin/users', {
      method: user ? 'PATCH' : 'POST',
      body: user ? { name, ...(!self ? { roleCode } : {}) } : { name, email, roleCode },
    }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin-users'] });
      if (user) await client.invalidateQueries({ queryKey: ['admin-user', user.id] });
      if (self) await reload();
      onSaved(user ? 'Perubahan pengguna berhasil disimpan.' : 'Undangan aktivasi dibuat dan masuk antrean notifikasi. Pengiriman email menunggu dispatcher.');
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const pending = save.isPending;
  const ready = !user || Boolean(detail.data);
  const submit = (event: FormEvent) => { event.preventDefault(); if (canManage && ready && !pending) save.mutate(); };
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }} title={user ? 'Detail pengguna' : 'Undang pengguna platform'} description={user ? 'Kelola identitas dan role akses platform. Email tidak dapat diubah di sini.' : 'Akun baru menerima undangan aktivasi satu kali; tidak ada password yang dikirim.'}
      footer={<><Button variant="secondary" onClick={onClose} disabled={pending}>Tutup</Button>{canManage && <Button type="submit" form="platform-user-form" loading={pending} disabled={!ready}>{user ? 'Simpan perubahan' : 'Buat undangan'}</Button>}</>}>
      {detail.error ? <ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} /> : !ready ? <Skeleton className="h-48" /> : <form id="platform-user-form" onSubmit={submit} className="space-y-4">
        {!canManage && <Alert tone="info">Anda memiliki akses baca saja untuk akun ini.</Alert>}
        {!user && <Alert tone="info">Undangan masuk antrean notifikasi. Pengiriman email memerlukan dispatcher yang dikonfigurasi.</Alert>}
        {save.error && <Alert>{save.error.message}</Alert>}
        {detail.data && <div className="space-y-2 text-xs text-muted"><StatusBadge status={detail.data.status} /><p>Dibuat: {formatDateTime(detail.data.createdAt)}</p><p>Terakhir masuk: {detail.data.lastLoginAt ? formatDateTime(detail.data.lastLoginAt) : 'Belum pernah masuk'}</p></div>}
        <FormField label="Nama pengguna" required error={errors.name?.[0]}>{(props) => <Input {...props} required minLength={2} maxLength={120} value={name} disabled={!canManage || pending} onChange={(event) => setName(event.target.value)} />}</FormField>
        <FormField label="Email" required error={errors.email?.[0]}>{(props) => <Input {...props} required type="email" maxLength={254} value={user?.email ?? email} disabled={Boolean(user) || !canManage || pending} onChange={(event) => setEmail(event.target.value)} />}</FormField>
        <FormField label="Role platform" required error={errors.roleCode?.[0]} hint={self ? 'Role akun sendiri tidak dapat diubah.' : 'Perubahan role mencabut refresh session; permission diperiksa ulang pada setiap request.'}>{(props) => <Select {...props} value={roleCode} disabled={self || !canManage || pending} onChange={(event) => setRoleCode(event.target.value as PlatformRole)}>{Object.entries(ROLE_LABELS).filter(([code]) => isSuper || code !== 'PLATFORM_SUPER_ADMIN').map(([code, label]) => <option key={code} value={code}>{label}</option>)}{!isSuper && targetSuper && <option value="PLATFORM_SUPER_ADMIN">Super admin</option>}</Select>}</FormField>
      </form>}
    </Dialog>
  );
}
