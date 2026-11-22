import { Badge } from '@/components/ui/badge';

export type MasterRecord = {
  id: string;
  name: string;
  code?: string;
  slug?: string;
  active: boolean;
  sortOrder?: number;
  description?: string | null;
  mandatory?: boolean;
  ownerType?: 'FACILITY' | 'PRACTITIONER';
  categoryId?: string;
  category?: { id: string; name: string; slug: string; active: boolean };
  createdAt: string;
  updatedAt: string;
};

export type FieldName = 'code' | 'slug' | 'name' | 'sortOrder' | 'description' | 'categoryId' | 'ownerType' | 'mandatory' | 'active';

export type FieldDef = { name: FieldName; label: string; kind: 'text' | 'number' | 'textarea' | 'category' | 'ownerType' | 'switch'; required?: boolean; createOnly?: boolean; hint?: string; placeholder?: string };

export type Column = { label: string; render: (row: MasterRecord) => React.ReactNode; className?: string };

export type MasterResourceConfig = {
  key: string;
  apiPath: string;
  title: string;
  singular: string;
  description: string;
  keyField: 'code' | 'slug';
  fields: FieldDef[];
  columns: Column[];
  filters?: Array<'category' | 'ownerType'>;
  defaultSort?: 'sortOrder' | 'name';
};

export const OWNER_TYPE_LABELS: Record<string, string> = { FACILITY: 'Klinik', PRACTITIONER: 'Nakes' };

const CODE_FIELD: FieldDef = { name: 'code', label: 'Kode', kind: 'text', required: true, createOnly: true, hint: 'Huruf, angka, atau garis bawah. Tidak bisa diubah setelah disimpan.', placeholder: 'CONTOH_KODE' };
const NAME_FIELD: FieldDef = { name: 'name', label: 'Nama', kind: 'text', required: true };
const SORT_FIELD: FieldDef = { name: 'sortOrder', label: 'Urutan tampil', kind: 'number', hint: 'Angka kecil tampil lebih dulu.' };
const ACTIVE_FIELD: FieldDef = { name: 'active', label: 'Aktif', kind: 'switch', hint: 'Data nonaktif tidak bisa dipilih untuk data baru, tapi tetap tersimpan di data lama.' };

const codeColumn: Column = { label: 'Kode', render: (row) => <code className="rounded bg-app px-1.5 py-0.5 text-xs text-ink">{row.code ?? row.slug}</code> };
const nameColumn: Column = { label: 'Nama', render: (row) => <span className="font-medium text-ink">{row.name}</span> };
const sortColumn: Column = { label: 'Urutan', render: (row) => row.sortOrder ?? '—', className: 'w-24' };

const taxonomy = (key: string, title: string, singular: string, description: string): MasterResourceConfig => ({
  key,
  apiPath: `/admin/master/${key}`,
  title,
  singular,
  description,
  keyField: 'code',
  fields: [CODE_FIELD, NAME_FIELD, SORT_FIELD, ACTIVE_FIELD],
  columns: [codeColumn, nameColumn, sortColumn],
});

/** Master tables of spec §4 / DESIGN.md §6.13. Clinic class and capabilities stay separate dimensions. */
export const MASTER_RESOURCES: MasterResourceConfig[] = [
  taxonomy('facility-types', 'Jenis fasilitas', 'jenis fasilitas', 'Jenis fasilitas kesehatan, mis. klinik.'),
  taxonomy('clinic-classes', 'Kelas klinik', 'kelas klinik', 'Klasifikasi klinik, mis. pratama atau utama.'),
  taxonomy('facility-capabilities', 'Kapabilitas', 'kapabilitas', 'Kemampuan layanan fasilitas, mis. rawat jalan atau rawat inap. Terpisah dari kelas klinik.'),
  taxonomy('practitioner-types', 'Jenis nakes', 'jenis nakes', 'Profesi tenaga kesehatan, mis. dokter, perawat, bidan.'),
  {
    key: 'service-categories',
    apiPath: '/admin/master/service-categories',
    title: 'Kategori layanan',
    singular: 'kategori layanan',
    description: 'Pengelompokan master service, mis. laboratorium atau vaksinasi.',
    keyField: 'slug',
    fields: [
      { name: 'slug', label: 'Slug', kind: 'text', required: true, createOnly: true, hint: 'Huruf kecil, angka, atau tanda hubung. Tidak bisa diubah setelah disimpan.', placeholder: 'contoh-kategori' },
      NAME_FIELD,
      SORT_FIELD,
      ACTIVE_FIELD,
    ],
    columns: [codeColumn, nameColumn, sortColumn],
  },
  {
    key: 'master-services',
    apiPath: '/admin/master/master-services',
    title: 'Master service',
    singular: 'master service',
    description: 'Taksonomi layanan platform. Klinik membuat layanan jualnya dari daftar ini.',
    keyField: 'code',
    defaultSort: 'name',
    filters: ['category'],
    fields: [
      CODE_FIELD,
      NAME_FIELD,
      { name: 'categoryId', label: 'Kategori', kind: 'category', required: true },
      { name: 'description', label: 'Deskripsi', kind: 'textarea' },
      ACTIVE_FIELD,
    ],
    columns: [codeColumn, nameColumn, { label: 'Kategori', render: (row) => row.category?.name ?? '—' }],
  },
  {
    key: 'document-requirements',
    apiPath: '/admin/master/document-requirements',
    title: 'Persyaratan dokumen',
    singular: 'persyaratan dokumen',
    description: 'Daftar dokumen verifikasi untuk klinik dan nakes. Isinya ditetapkan bersama tim legal/operasional.',
    keyField: 'code',
    filters: ['ownerType'],
    fields: [
      CODE_FIELD,
      { name: 'ownerType', label: 'Untuk', kind: 'ownerType', required: true, createOnly: true },
      NAME_FIELD,
      { name: 'description', label: 'Keterangan', kind: 'textarea' },
      { name: 'mandatory', label: 'Wajib', kind: 'switch', hint: 'Pengajuan tidak bisa dikirim tanpa dokumen wajib.' },
      SORT_FIELD,
      ACTIVE_FIELD,
    ],
    columns: [
      codeColumn,
      nameColumn,
      { label: 'Untuk', render: (row) => OWNER_TYPE_LABELS[row.ownerType ?? ''] ?? '—' },
      { label: 'Wajib', render: (row) => (row.mandatory ? <Badge tone="primary">Wajib</Badge> : <Badge>Opsional</Badge>) },
    ],
  },
];

export const findMasterResource = (key: string) => MASTER_RESOURCES.find((resource) => resource.key === key);
