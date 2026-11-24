'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus, Users } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Pagination } from '@/components/data/pagination';
import { Alert, EmptyState, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select } from '@/components/ui/fields';
import { Input } from '@/components/ui/input';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { StaffDialog } from '@/features/staff/staff-dialog';
import type { StaffMember } from '@/features/staff/types';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-provider';
import { canFacility } from '@/lib/auth/types';

const LIMIT = 20;
type Action = { member: StaffMember; kind: 'ENABLE' | 'DISABLE' | 'INVITE' };

export default function ClinicStaffPage() {
  const { me } = useAuth();
  const client = useQueryClient();
  const facilityId = me?.facility?.facilityId;
  const [search, setSearch] = useState('');
  const [access, setAccess] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{ member: StaffMember | null } | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const allowed = canFacility(me, 'staff:read');
  const canManage = canFacility(me, 'staff:manage');
  const staff = useQuery({ queryKey: ['clinic-staff', facilityId, deferredSearch, access, roleCode, page], queryFn: () => api<{ items: StaffMember[]; total: number }>('/clinic/staff', { query: { search: deferredSearch, access, roleCode, page, limit: LIMIT } }), enabled: allowed && Boolean(facilityId), placeholderData: keepPreviousData });
  const change = useMutation({
    mutationFn: async ({ member, kind, reason }: Action & { reason?: string }) => kind === 'INVITE' ? api<void>(`/clinic/staff/${member.id}/resend-invitation`, { method: 'POST' }) : api<StaffMember>(`/clinic/staff/${member.id}/access`, { method: 'POST', body: { action: kind, reason } }),
    onSuccess: async (member, variables) => {
      await client.invalidateQueries({ queryKey: ['clinic-staff', facilityId] });
      await client.invalidateQueries({ queryKey: ['clinic-staff-detail', facilityId, variables.member.id] });
      void client.invalidateQueries({ queryKey: ['admin-facilities'] });
      void client.invalidateQueries({ queryKey: ['clinic', 'profile'] });
      setNotice(variables.kind === 'INVITE' ? 'Undangan baru masuk antrean; pengiriman email ditunda.' : member?.active ? 'Akses klinik diaktifkan. Akun yang belum diaktivasi tetap memerlukan undangan.' : 'Akses klinik dinonaktifkan. Status akun global dan akses klinik lain tidak diubah.');
      setAction(null);
    },
  });
  const begin = (member: StaffMember, kind: Action['kind']) => { change.reset(); setNotice(''); setAction({ member, kind }); };
  const controls = (member: StaffMember) => {
    const writable = canManage && member.user.id !== me?.user.id && (member.role.code !== 'CLINIC_OWNER_ADMIN' || me?.facility?.role === 'CLINIC_OWNER_ADMIN');
    return <div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" aria-label={`Detail ${member.user.name}`} onClick={() => { setNotice(''); setEditor({ member }); }}>Detail</Button>{writable && <>
      {member.active && member.user.status === 'INVITED' && <Button variant="secondary" size="sm" onClick={() => begin(member, 'INVITE')}>Kirim ulang undangan</Button>}
      <Button variant={member.active ? 'destructive' : 'soft'} size="sm" disabled={!member.active && !['ACTIVE', 'INVITED'].includes(member.user.status)} onClick={() => begin(member, member.active ? 'DISABLE' : 'ENABLE')}>{member.active ? 'Nonaktifkan akses' : 'Aktifkan akses'}</Button>
    </>}</div>;
  };
  if (!allowed) return <ErrorState message="Anda tidak memiliki izin melihat staf klinik." />;
  return (
    <>
      <PageHeader title="Staf klinik" breadcrumbs={[{ label: 'Dashboard', href: '/clinic' }, { label: 'Staf' }]} description="Kelola membership dan role klinik sendiri. Status akses klinik terpisah dari status akun global." actions={canManage && <Button onClick={() => { setNotice(''); setEditor({ member: null }); }}><UserPlus />Tambah staf</Button>} />
      {notice && <Alert tone="success" className="mb-4">{notice}</Alert>}
      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-3 sm:p-5">
          <Input icon={Search} maxLength={100} aria-label="Cari staf" placeholder="Nama atau email staf..." value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          <Select aria-label="Akses staf" value={access} onChange={(event) => { setAccess(event.target.value); setPage(1); }}><option value="">Semua akses klinik</option><option value="ACTIVE">Akses aktif</option><option value="INACTIVE">Akses nonaktif</option></Select>
          <Select aria-label="Role staf" value={roleCode} onChange={(event) => { setRoleCode(event.target.value); setPage(1); }}><option value="">Semua role</option><option value="CLINIC_OWNER_ADMIN">Owner / admin klinik</option><option value="CLINIC_STAFF">Staf operasional</option></Select>
        </div>
        {staff.error ? <ErrorState message={staff.error.message} onRetry={() => void staff.refetch()} /> : staff.isLoading ? <div className="space-y-3 p-5">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-16" />)}</div> : !staff.data?.items.length ? <EmptyState icon={Users} title="Tidak ada staf" description="Belum ada staf yang sesuai dengan filter di klinik ini." /> : <>
          <ul className="divide-y divide-line lg:hidden">{staff.data.items.map((member) => <li key={member.id} className="space-y-3 p-4"><p className="break-words font-semibold text-ink">{member.user.name}{member.user.id === me?.user.id && ' (Anda)'}</p><p className="break-all text-sm text-muted">{member.user.email}</p><p className="text-xs text-muted">{member.role.name}</p><div className="flex flex-wrap gap-2 text-xs text-muted"><span>Akses klinik:</span><StatusBadge status={member.active ? 'ACTIVE' : 'INACTIVE'} /><span>Akun:</span><StatusBadge status={member.user.status} /></div>{controls(member)}</li>)}</ul>
          <div className="hidden overflow-x-auto lg:block"><table className="w-full text-left text-sm"><thead className="bg-app text-xs uppercase text-muted"><tr><th className="px-5 py-3">Staf</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Akses klinik</th><th className="px-5 py-3">Akun</th><th className="px-5 py-3">Aksi</th></tr></thead><tbody className="divide-y divide-line">{staff.data.items.map((member) => <tr key={member.id}><td className="max-w-xs px-5 py-4"><p className="break-words font-semibold text-ink">{member.user.name}{member.user.id === me?.user.id && ' (Anda)'}</p><p className="break-all text-xs text-muted">{member.user.email}</p></td><td className="px-5 py-4 text-muted">{member.role.name}</td><td className="px-5 py-4"><StatusBadge status={member.active ? 'ACTIVE' : 'INACTIVE'} /></td><td className="px-5 py-4"><StatusBadge status={member.user.status} /></td><td className="px-5 py-4">{controls(member)}</td></tr>)}</tbody></table></div>
        </>}
        <Pagination page={page} limit={LIMIT} total={staff.data?.total ?? 0} onPageChange={setPage} />
      </Card>
      {editor && <StaffDialog key={`${facilityId}-${editor.member?.id ?? 'new'}`} member={editor.member} onClose={() => setEditor(null)} onSaved={(message) => { setEditor(null); setNotice(message); }} />}
      {action && action.kind !== 'INVITE' && <ReasonDialog open onOpenChange={(open) => { if (!open) setAction(null); }} title={action.kind === 'ENABLE' ? 'Aktifkan akses klinik?' : 'Nonaktifkan akses klinik?'} description={`Staf: ${action.member.user.name}. Hanya membership klinik ini yang diubah; akun global dan klinik lain tidak berubah.`} label="Alasan perubahan akses" hint="Minimal 5 karakter, maksimal 1000 karakter. Dicatat di audit log." confirmLabel={action.kind === 'ENABLE' ? 'Aktifkan akses' : 'Nonaktifkan akses'} destructive={action.kind === 'DISABLE'} maxLength={1000} loading={change.isPending} error={change.error?.message} onConfirm={(reason) => change.mutate({ ...action, reason })} />}
      <ConfirmDialog open={action?.kind === 'INVITE'} onOpenChange={(open) => { if (!open) setAction(null); }} title="Buat ulang undangan staf?" description="Tautan lama akan dibatalkan. Undangan baru tersimpan di antrean; pengiriman email ditunda." confirmLabel="Buat ulang undangan" loading={change.isPending} onConfirm={() => { if (action) change.mutate(action); }}>{change.error ? <Alert>{change.error.message}</Alert> : undefined}</ConfirmDialog>
    </>
  );
}
