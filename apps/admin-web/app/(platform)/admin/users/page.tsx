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
import { UserDialog } from '@/features/users/user-dialog';
import { ROLE_LABELS, type PlatformUser } from '@/features/users/types';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-provider';
import { canPlatform } from '@/lib/auth/types';

const LIMIT = 20;
type Action = { user: PlatformUser; kind: 'ENABLE' | 'SUSPEND' | 'DISABLE' | 'INVITE' };
const ACTION_LABELS = { ENABLE: 'Aktifkan kembali', SUSPEND: 'Suspend pengguna', DISABLE: 'Nonaktifkan pengguna', INVITE: 'Kirim ulang undangan' };

export default function UsersPage() {
  const { me } = useAuth();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{ user: PlatformUser | null } | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const allowed = canPlatform(me, 'platform-user:read');
  const canManage = canPlatform(me, 'platform-user:manage');
  const users = useQuery({
    queryKey: ['admin-users', deferredSearch, status, roleCode, page],
    queryFn: () => api<{ items: PlatformUser[]; total: number }>('/admin/users', { query: { search: deferredSearch, status, roleCode, page, limit: LIMIT } }),
    enabled: allowed, placeholderData: keepPreviousData,
  });
  const change = useMutation({
    mutationFn: async ({ user, kind, reason }: Action & { reason?: string }) => {
      if (kind === 'INVITE') return api<void>(`/admin/users/${user.id}/resend-invitation`, { method: 'POST' });
      return api<PlatformUser>(`/admin/users/${user.id}/status`, { method: 'POST', body: { action: kind, reason } });
    },
    onSuccess: async (user, variables) => {
      await client.invalidateQueries({ queryKey: ['admin-users'] });
      await client.invalidateQueries({ queryKey: ['admin-user', variables.user.id] });
      setNotice(variables.kind === 'INVITE' || user?.status === 'INVITED' ? 'Undangan aktivasi masuk antrean notifikasi. Pengiriman email menunggu dispatcher.' : 'Status pengguna berhasil diperbarui.');
      setAction(null);
    },
  });
  const begin = (user: PlatformUser, kind: Action['kind']) => { change.reset(); setNotice(''); setAction({ user, kind }); };
  const controls = (user: PlatformUser) => {
    const targetSuper = user.memberships.some((entry) => entry.role.code === 'PLATFORM_SUPER_ADMIN');
    const writable = canManage && user.id !== me?.user.id && (!targetSuper || me?.platform?.roles.includes('PLATFORM_SUPER_ADMIN'));
    return <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" onClick={() => { setNotice(''); setEditor({ user }); }} aria-label={`Detail ${user.name}`}>Detail</Button>
      {writable && <>
        {user.status === 'INVITED' && <Button variant="secondary" size="sm" onClick={() => begin(user, 'INVITE')}>Kirim ulang undangan</Button>}
        {['SUSPENDED', 'DISABLED'].includes(user.status) && <Button variant="soft" size="sm" onClick={() => begin(user, 'ENABLE')}>Aktifkan kembali</Button>}
        {user.status === 'ACTIVE' && <Button variant="secondary" size="sm" onClick={() => begin(user, 'SUSPEND')}>Suspend</Button>}
        {user.status !== 'DISABLED' && <Button variant="destructive" size="sm" onClick={() => begin(user, 'DISABLE')}>Nonaktifkan</Button>}
      </>}
    </div>;
  };
  if (!allowed) return <ErrorState message="Anda tidak memiliki izin melihat pengguna platform." />;
  return (
    <>
      <PageHeader title="Pengguna platform" breadcrumbs={[{ label: 'Dashboard', href: '/admin' }, { label: 'Pengguna' }]} description="Kelola akun admin platform. Owner klinik dikelola lewat Klinik; staf dikelola terpisah di klinik masing-masing." actions={canManage && <Button onClick={() => { setNotice(''); setEditor({ user: null }); }}><UserPlus />Undang pengguna</Button>} />
      {notice && <Alert tone="success" className="mb-4">{notice}</Alert>}
      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-3 sm:p-5">
          <Input icon={Search} maxLength={100} aria-label="Cari pengguna" placeholder="Nama atau email..." value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          <Select aria-label="Status pengguna" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">Semua status</option><option value="INVITED">Menunggu aktivasi</option><option value="ACTIVE">Aktif</option><option value="SUSPENDED">Disuspend</option><option value="DISABLED">Dinonaktifkan</option></Select>
          <Select aria-label="Role pengguna" value={roleCode} onChange={(event) => { setRoleCode(event.target.value); setPage(1); }}><option value="">Semua role</option>{Object.entries(ROLE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</Select>
        </div>
        {users.error ? <ErrorState message={users.error.message} onRetry={() => void users.refetch()} /> : users.isLoading ? <div className="space-y-3 p-5">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-16" />)}</div> : !users.data?.items.length ? <EmptyState icon={Users} title="Tidak ada pengguna" description="Belum ada pengguna platform yang cocok dengan filter." /> : <>
          <ul className="divide-y divide-line lg:hidden">{users.data.items.map((user) => <li key={user.id} className="space-y-3 p-4"><p className="break-words font-semibold text-ink">{user.name}{user.id === me?.user.id && ' (Anda)'}</p><p className="break-all text-sm text-muted">{user.email}</p><p className="text-xs text-muted">{user.memberships.map((entry) => entry.role.name).join(', ')}</p><StatusBadge status={user.status} />{controls(user)}</li>)}</ul>
          <div className="hidden overflow-x-auto lg:block"><table className="w-full text-left text-sm"><thead className="bg-app text-xs uppercase text-muted"><tr><th className="px-5 py-3">Pengguna</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Aksi</th></tr></thead><tbody className="divide-y divide-line">{users.data.items.map((user) => <tr key={user.id}><td className="max-w-xs px-5 py-4"><p className="break-words font-semibold text-ink">{user.name}{user.id === me?.user.id && ' (Anda)'}</p><p className="break-all text-xs text-muted">{user.email}</p></td><td className="px-5 py-4 text-muted">{user.memberships.map((entry) => entry.role.name).join(', ')}</td><td className="px-5 py-4"><StatusBadge status={user.status} /></td><td className="px-5 py-4">{controls(user)}</td></tr>)}</tbody></table></div>
        </>}
        <Pagination page={page} limit={LIMIT} total={users.data?.total ?? 0} onPageChange={setPage} />
      </Card>
      {editor && <UserDialog key={editor.user?.id ?? 'new'} user={editor.user} onClose={() => setEditor(null)} onSaved={(message) => { setEditor(null); setNotice(message); }} />}
      {action && action.kind !== 'INVITE' && <ReasonDialog open onOpenChange={(open) => { if (!open) setAction(null); }} title={`${ACTION_LABELS[action.kind]}?`} description={`Akun: ${action.user.name}. Perubahan berlaku pada akses akun dan dicatat dalam audit log. Aktifkan kembali akun tanpa password akan membuat undangan baru.`} label="Alasan perubahan status" hint="Minimal 5 karakter, maksimal 1000 karakter. Disimpan dalam audit log." confirmLabel={ACTION_LABELS[action.kind]} destructive={action.kind !== 'ENABLE'} maxLength={1000} loading={change.isPending} error={change.error?.message} onConfirm={(reason) => change.mutate({ ...action, reason })} />}
      <ConfirmDialog open={action?.kind === 'INVITE'} onOpenChange={(open) => { if (!open) setAction(null); }} title="Kirim ulang undangan?" description="Tautan sebelumnya dibatalkan. Undangan baru masuk antrean notifikasi, bukan langsung terkirim." confirmLabel="Kirim ulang" loading={change.isPending} onConfirm={() => { if (action) change.mutate(action); }}>{change.error ? <Alert>{change.error.message}</Alert> : undefined}</ConfirmDialog>
    </>
  );
}
