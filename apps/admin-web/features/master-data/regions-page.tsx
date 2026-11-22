'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, MapPinned, Search } from 'lucide-react';
import { useDeferredValue, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import { Pagination } from '@/components/data/pagination';
import { Alert, EmptyState, ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/fields';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-provider';
import { canPlatform } from '@/lib/auth/types';
import { parseRegionCsv, type RegionCsvRow } from '@/lib/csv';
import { formatNumber } from '@/lib/format';
import { useUrlState } from '@/lib/use-url-state';

type Region = { code: string; name: string; level: number; parentCode: string | null; parent: { code: string; name: string } | null };
type Page<T> = { items: T[]; page: number; limit: number; total: number };
type ImportResult = { imported: number; created: number; updated: number };

const LIMIT = 50;
const MAX_ROWS = 5000;
const LEVELS: Record<number, string> = { 1: 'Provinsi', 2: 'Kabupaten/Kota', 3: 'Kecamatan', 4: 'Kelurahan/Desa' };
const FILTER_DEFAULTS = { search: '', level: '', parentCode: '', page: '1' };

/** Geographic reference data: lookup and CSV import, no manual editing (spec §2). */
export function RegionsPage() {
  const { me } = useAuth();
  const canWrite = canPlatform(me, 'master:write');
  const [filters, setFilters] = useUrlState(FILTER_DEFAULTS);
  const [searchInput, setSearchInput] = useState(filters.search);
  const deferredSearch = useDeferredValue(searchInput.trim());
  const [importOpen, setImportOpen] = useState(false);
  const page = Math.max(1, Number(filters.page) || 1);

  useEffect(() => {
    if (deferredSearch !== filters.search) setFilters({ search: deferredSearch, page: '1' });
  }, [deferredSearch, filters.search, setFilters]);

  const list = useQuery({
    queryKey: ['master', 'regions', filters],
    queryFn: () => api<Page<Region>>('/admin/master/regions', { query: { page, limit: LIMIT, search: filters.search, level: filters.level, parentCode: filters.parentCode } }),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink">Wilayah</h2>
          <p className="mt-0.5 text-sm text-muted">Data referensi provinsi hingga kelurahan. Diperbarui lewat import, tidak diedit manual.</p>
        </div>
        {canWrite && <Button className="w-full sm:w-auto" variant="secondary" onClick={() => setImportOpen(true)}><FileUp /> Import CSV</Button>}
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-3 border-b border-line p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5">
          <Input icon={Search} aria-label="Cari wilayah" placeholder="Cari nama atau awalan kode..." value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
          <Select aria-label="Filter level" value={filters.level} onChange={(event) => setFilters({ level: event.target.value, page: '1' })}>
            <option value="">Semua level</option>
            {Object.entries(LEVELS).map(([level, label]) => <option key={level} value={level}>{label}</option>)}
          </Select>
        </div>
        {filters.parentCode && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 text-sm text-muted sm:px-5">
            Menampilkan bagian dari <code className="rounded bg-app px-1.5 py-0.5 text-ink">{filters.parentCode}</code>
            <Button variant="ghost" size="sm" onClick={() => setFilters({ parentCode: '', page: '1' })}>Hapus filter</Button>
          </div>
        )}

        {list.error ? (
          <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
        ) : list.isLoading ? (
          <div className="space-y-3 p-5">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-10 w-full" />)}</div>
        ) : !items.length ? (
          <EmptyState icon={MapPinned} title="Belum ada data wilayah" description={canWrite ? 'Import file CSV wilayah untuk mengisi data referensi.' : undefined} />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((region) => (
              <li key={region.code} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                <code className="w-24 shrink-0 text-xs text-muted">{region.code}</code>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{region.name}</p>
                  <p className="text-xs text-muted">{LEVELS[region.level]}{region.parent ? ` · ${region.parent.name}` : ''}</p>
                </div>
                {region.level < 4 && (
                  <Button variant="ghost" size="sm" onClick={() => setFilters({ parentCode: region.code, level: String(region.level + 1), search: '', page: '1' })}>
                    Lihat {LEVELS[region.level + 1]?.toLowerCase()}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {list.data && list.data.total > 0 && <Pagination page={page} limit={LIMIT} total={list.data.total} onPageChange={(next) => setFilters({ page: String(next) })} />}
      </Card>

      {importOpen && <RegionImportDialog open={importOpen} onOpenChange={setImportOpen} />}
    </>
  );
}

function RegionImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<RegionCsvRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [rowErrors, setRowErrors] = useState<Array<[string, string[]]>>([]);

  const upload = useMutation({
    mutationFn: () => api<ImportResult>('/admin/master/regions/import', { method: 'POST', body: { rows } }),
    onSuccess: async (result) => {
      toast.success(`${formatNumber(result.imported)} wilayah diimport (${formatNumber(result.created)} baru, ${formatNumber(result.updated)} diperbarui)`);
      await queryClient.invalidateQueries({ queryKey: ['master', 'regions'] });
      onOpenChange(false);
    },
    onError: (cause) => {
      if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length) {
        setError(cause.message);
        setRowErrors(Object.entries(cause.fieldErrors));
      } else setError(cause instanceof ApiError ? cause.message : 'Import gagal. Coba lagi.');
    },
  });

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError('');
    setRowErrors([]);
    setRows([]);
    if (!file) return;
    setFileName(file.name);
    const parsed = parseRegionCsv(await file.text());
    if (parsed.error) return setError(parsed.error);
    if (parsed.rows.length > MAX_ROWS) return setError(`Maksimal ${formatNumber(MAX_ROWS)} baris per import; file ini berisi ${formatNumber(parsed.rows.length)}. Pecah file per provinsi.`);
    setRows(parsed.rows);
  }

  /** "rows.12" from the API is the 13th data row, i.e. line 14 of the file (after the header). */
  const lineOf = (field: string) => Number(field.split('.')[1] ?? 0) + 2;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !upload.isPending && onOpenChange(next)}
      title="Import wilayah dari CSV"
      description="Baris dengan kode yang sudah ada akan diperbarui. Semua baris harus valid; jika ada yang salah, tidak ada yang disimpan."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={upload.isPending}>Batal</Button>
          <Button onClick={() => upload.mutate()} disabled={!rows.length} loading={upload.isPending}>Import {rows.length ? formatNumber(rows.length) : ''} baris</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-[var(--radius-input)] bg-app p-3 text-xs text-muted">
          Header wajib: <code className="text-ink">code,name,level,parent_code</code>. Level 1 provinsi, 2 kabupaten/kota, 3 kecamatan, 4 kelurahan/desa.
          Provinsi tidak punya <code className="text-ink">parent_code</code>; level lain wajib mengacu ke wilayah satu level di atasnya.
        </div>
        <input ref={fileInput} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => void chooseFile(event)} />
        <Button variant="secondary" className="w-full" onClick={() => fileInput.current?.click()}><FileUp /> {fileName || 'Pilih file CSV'}</Button>
        {rows.length > 0 && !error && <Alert tone="info">{formatNumber(rows.length)} baris siap diimport.</Alert>}
        {error && <Alert>{error}</Alert>}
        {rowErrors.length > 0 && (
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-[var(--radius-input)] border border-line p-3 text-xs">
            {rowErrors.slice(0, 50).map(([field, messages]) => (
              <li key={field}><span className="font-semibold text-ink">Baris {lineOf(field)}:</span> <span className="text-danger">{messages.join('; ')}</span></li>
            ))}
            {rowErrors.length > 50 && <li className="text-muted">…dan {formatNumber(rowErrors.length - 50)} baris lainnya.</li>}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
