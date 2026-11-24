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
import { canFacility } from '@/lib/auth/types';
import type { ClinicRole, StaffMember } from './types';

export function StaffDialog({ member, onClose, onSaved }: { member: StaffMember | null; onClose: () => void; onSaved: (message: string) => void }) {
  const { me } = useAuth();
  const client = useQueryClient();
  const facilityId = me?.facility?.facilityId;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleCode, setRoleCode] = useState('CLINIC_STAFF');
  const self = member?.user.id === me?.user.id;
  const owner = me?.facility?.role === 'CLINIC_OWNER_ADMIN';
  const canManage = canFacility(me, 'staff:manage') && !self && (member?.role.code !== 'CLINIC_OWNER_ADMIN' || owner);
  const detail = useQuery({ queryKey: ['clinic-staff-detail', facilityId, member?.id], queryFn: () => api<StaffMember>(`/clinic/staff/${member!.id}`), enabled: Boolean(member && facilityId) });
  const roles = useQuery({ queryKey: ['clinic-staff-roles', facilityId], queryFn: () => api<ClinicRole[]>('/clinic/staff/roles'), enabled: Boolean(facilityId) });
  useEffect(() => { if (detail.data) setRoleCode(detail.data.role.code); }, [detail.data]);
  const save = useMutation({
    mutationFn: () => api<StaffMember>(member ? `/clinic/staff/${member.id}` : '/clinic/staff', { method: member ? 'PATCH' : 'POST', body: member ? { roleCode } : { name, email, roleCode } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['clinic-staff', facilityId] });
      if (member) await client.invalidateQueries({ queryKey: ['clinic-staff-detail', facilityId, member.id] });
      void client.invalidateQueries({ queryKey: ['admin-facilities'] });
      void client.invalidateQueries({ queryKey: ['clinic', 'profile'] });
      onSaved(member ? 'Role staf berhasil diperbarui.' : 'Staf ditambahkan. Undangan aktivasi tersimpan di antrean; pengiriman email ditunda.');
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const pending = save.isPending;
  const ready = (!member || Boolean(detail.data)) && Boolean(roles.data?.length);
  const selectedRole = roles.data?.find((role) => role.code === roleCode) ?? detail.data?.role;
  const submit = (event: FormEvent) => { event.preventDefault(); if (canManage && ready && !pending) save.mutate(); };
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }} title={member ? 'Detail staf klinik' : 'Tambah staf klinik'} description="Role dan akses berlaku hanya untuk klinik yang sedang dikelola."
      footer={<><Button variant="secondary" onClick={onClose} disabled={pending}>Tutup</Button>{canManage && <Button type="submit" form="clinic-staff-form" loading={pending} disabled={!ready || Boolean(member && roleCode === detail.data?.role.code)}>{member ? 'Simpan role' : 'Tambah staf'}</Button>}</>}>
      {detail.error || roles.error ? <ErrorState message={(detail.error ?? roles.error)!.message} onRetry={() => { if (member) void detail.refetch(); void roles.refetch(); }} /> : roles.data?.length === 0 ? <Alert>Role klinik belum dikonfigurasi. Hubungi admin platform untuk menjalankan seed.</Alert> : !ready ? <Skeleton className="h-48" /> : <form id="clinic-staff-form" onSubmit={submit} className="space-y-4">
        {!canManage && <Alert tone="info">{self ? 'Role dan akses akun sendiri tidak dapat diubah.' : 'Anda memiliki akses baca saja untuk staf ini.'}</Alert>}
        {!member && <Alert tone="info">Gunakan email baru. Akun tidak langsung aktif dan pengiriman email ditunda; tidak ada password atau token yang ditampilkan.</Alert>}
        {save.error && <Alert>{save.error.message}</Alert>}
        {detail.data && <div className="flex flex-wrap gap-2"><StatusBadge status={detail.data.active ? 'ACTIVE' : 'INACTIVE'} /><span className="text-sm text-muted">Status akun:</span><StatusBadge status={detail.data.user.status} /></div>}
        <FormField label="Nama staf" required error={errors.name?.[0]} hint={member ? 'Identitas akun tidak diubah melalui manajemen akses klinik.' : undefined}>{(props) => <Input {...props} required minLength={2} maxLength={120} value={member?.user.name ?? name} disabled={Boolean(member) || !canManage || pending} onChange={(event) => setName(event.target.value)} />}</FormField>
        <FormField label="Email staf" required error={errors.email?.[0]}>{(props) => <Input {...props} required type="email" maxLength={254} value={member?.user.email ?? email} disabled={Boolean(member) || !canManage || pending} onChange={(event) => setEmail(event.target.value)} />}</FormField>
        <FormField label="Role klinik" required error={errors.roleCode?.[0]}>{(props) => <Select {...props} value={roleCode} disabled={!canManage || pending} onChange={(event) => setRoleCode(event.target.value)}>{roles.data?.filter((role) => owner || role.code !== 'CLINIC_OWNER_ADMIN' || member?.role.code === role.code).map((role) => <option key={role.code} value={role.code}>{role.name}</option>)}</Select>}</FormField>
        {roleCode === 'CLINIC_OWNER_ADMIN' && <Alert tone="warning">Owner/admin memiliki akses pengelolaan staf, profil, verifikasi, dan operasional klinik. Berikan hanya kepada pihak yang berwenang.</Alert>}
        <section className="space-y-2"><h2 className="text-sm font-semibold text-ink">Permission role ini</h2><p className="text-xs text-muted">Mengikuti role existing; perubahan ini tidak mengubah permission global atau klinik lain.</p><ul className="flex flex-wrap gap-2">{selectedRole?.permissions.map((permission) => <li key={permission} className="max-w-full break-all rounded-md bg-app px-2 py-1 text-xs text-muted">{permission}</li>)}</ul></section>
      </form>}
    </Dialog>
  );
}
