'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, MoreVertical, Pencil, Plus, Power, PowerOff, Search } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Pagination } from '@/components/data/pagination';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { StatusBadge } from '@/components/status/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select } from '@/components/ui/fields';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-provider';
import { canPlatform } from '@/lib/auth/types';
import { useUrlState } from '@/lib/use-url-state';
import { OWNER_TYPE_LABELS, type MasterRecord, type MasterResourceConfig } from './config';
import { MasterFormDialog, useActiveCategories } from './master-form-dialog';

type Page<T> = { items: T[]; page: number; limit: number; total: number };

const LIMIT = 20;
const FILTER_DEFAULTS = { search: '', active: '', page: '1', categoryId: '', ownerType: '' };

/** List, filter, create, edit, and (de)activate one master table (DESIGN.md §6.13). */
export function MasterResourcePage({ config }: { config: MasterResourceConfig }) {
  const { me } = useAuth();
  const canWrite = canPlatform(me, 'master:write');
  const queryClient = useQueryClient();
  const [filters, setFilters] = useUrlState(FILTER_DEFAULTS);
  const [searchInput, setSearchInput] = useState(filters.search);
  const deferredSearch = useDeferredValue(searchInput.trim());
  const [editing, setEditing] = useState<MasterRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toggling, setToggling] = useState<MasterRecord | null>(null);
  const page = Math.max(1, Number(filters.page) || 1);
  const categories = useActiveCategories(Boolean(config.filters?.includes('category')));

  // Typing updates the URL once the input settles, and always returns to page 1.
  useEffect(() => {
    if (deferredSearch !== filters.search) setFilters({ search: deferredSearch, page: '1' });
  }, [deferredSearch, filters.search, setFilters]);

  const query = useMemo(
    () => ({
      page,
      limit: LIMIT,
      search: filters.search,
      active: filters.active,
      sortBy: config.defaultSort ?? 'sortOrder',
      sortOrder: 'asc',
      ...(config.filters?.includes('category') ? { categoryId: filters.categoryId } : {}),
      ...(config.filters?.includes('ownerType') ? { ownerType: filters.ownerType } : {}),
    }),
    [page, filters, config],
  );
  const list = useQuery({
    queryKey: ['master', config.key, query],
    queryFn: () => api<Page<MasterRecord>>(config.apiPath, { query }),
    placeholderData: keepPreviousData,
  });

  const toggle = useMutation({
    mutationFn: (record: MasterRecord) => api<MasterRecord>(`${config.apiPath}/${record.id}`, { method: 'PATCH', body: { active: !record.active } }),
    onSuccess: async (saved) => {
      toast.success(`${saved.name} ${saved.active ? 'diaktifkan' : 'dinonaktifkan'}`);
      setToggling(null);
      await queryClient.invalidateQueries({ queryKey: ['master', config.key] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Status gagal diubah.'),
  });

  const openForm = (record: MasterRecord | null) => {
    setEditing(record);
    setFormOpen(true);
  };
  const requestToggle = (record: MasterRecord) => (record.active ? setToggling(record) : toggle.mutate(record));
  const items = list.data?.items ?? [];
  const filtered = Boolean(filters.search || filters.active || filters.categoryId || filters.ownerType);

  const actions = (record: MasterRecord) =>
    canWrite && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Aksi untuk ${record.name}`}><MoreVertical /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => openForm(record)}><Pencil /> Ubah</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => requestToggle(record)}>
            {record.active ? <><PowerOff /> Nonaktifkan</> : <><Power /> Aktifkan</>}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink">{config.title}</h2>
          <p className="mt-0.5 text-sm text-muted">{config.description}</p>
        </div>
        {canWrite && <Button className="w-full sm:w-auto" onClick={() => openForm(null)}><Plus /> Tambah</Button>}
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-3 border-b border-line p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <Input icon={Search} aria-label={`Cari ${config.singular}`} placeholder="Cari nama atau kode..." value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
          {config.filters?.includes('category') && (
            <Select aria-label="Filter kategori" value={filters.categoryId} onChange={(event) => setFilters({ categoryId: event.target.value, page: '1' })}>
              <option value="">Semua kategori</option>
              {(categories.data?.items ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
          )}
          {config.filters?.includes('ownerType') && (
            <Select aria-label="Filter pemilik dokumen" value={filters.ownerType} onChange={(event) => setFilters({ ownerType: event.target.value, page: '1' })}>
              <option value="">Klinik & nakes</option>
              {Object.entries(OWNER_TYPE_LABELS).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
            </Select>
          )}
          <Select aria-label="Filter status" value={filters.active} onChange={(event) => setFilters({ active: event.target.value, page: '1' })}>
            <option value="">Semua status</option>
            <option value="true">Aktif</option>
            <option value="false">Nonaktif</option>
          </Select>
        </div>

        {list.error ? (
          <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
        ) : list.isLoading ? (
          <div className="space-y-3 p-5">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-10 w-full" />)}</div>
        ) : !items.length ? (
          <EmptyState
            icon={Database}
            title={filtered ? 'Tidak ada data yang cocok' : `Belum ada ${config.singular}`}
            description={filtered ? 'Ubah kata kunci atau filter.' : canWrite ? 'Tambahkan data pertama.' : undefined}
            action={!filtered && canWrite ? <Button variant="secondary" onClick={() => openForm(null)}><Plus /> Tambah {config.singular}</Button> : undefined}
          />
        ) : (
          <>
            <ul className="divide-y divide-line md:hidden">
              {items.map((record) => (
                <li key={record.id} className="flex items-start gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="font-semibold text-ink [overflow-wrap:anywhere]">{record.name}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <code className="rounded bg-app px-1.5 py-0.5 text-ink">{record.code ?? record.slug}</code>
                      {record.category && <span>{record.category.name}</span>}
                      {record.ownerType && <span>{OWNER_TYPE_LABELS[record.ownerType]}</span>}
                      <StatusBadge status={record.active ? 'ACTIVE' : 'INACTIVE'} />
                    </div>
                  </div>
                  {actions(record)}
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-app text-xs font-semibold uppercase tracking-wide text-muted">
                  <tr>
                    {config.columns.map((column) => <th key={column.label} scope="col" className={`px-5 py-3 ${column.className ?? ''}`}>{column.label}</th>)}
                    <th scope="col" className="w-32 px-5 py-3">Status</th>
                    {canWrite && <th scope="col" className="w-16 px-5 py-3"><span className="sr-only">Aksi</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items.map((record) => (
                    <tr key={record.id} className="hover:bg-app/60">
                      {config.columns.map((column) => <td key={column.label} className="px-5 py-3 text-muted">{column.render(record)}</td>)}
                      <td className="px-5 py-3"><StatusBadge status={record.active ? 'ACTIVE' : 'INACTIVE'} /></td>
                      {canWrite && <td className="px-3 py-1.5 text-right">{actions(record)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {list.data && list.data.total > 0 && <Pagination page={page} limit={LIMIT} total={list.data.total} onPageChange={(next) => setFilters({ page: String(next) })} />}
      </Card>

      {formOpen && <MasterFormDialog key={editing?.id ?? 'new'} config={config} record={editing} open={formOpen} onOpenChange={setFormOpen} />}
      <ConfirmDialog
        open={Boolean(toggling)}
        onOpenChange={(open) => !open && setToggling(null)}
        title={`Nonaktifkan ${toggling?.name ?? ''}?`}
        description="Data nonaktif tidak bisa dipilih untuk data baru. Data lama yang sudah memakainya tidak berubah."
        confirmLabel="Nonaktifkan"
        destructive
        loading={toggle.isPending}
        onConfirm={() => toggling && toggle.mutate(toggling)}
      />
    </>
  );
}
