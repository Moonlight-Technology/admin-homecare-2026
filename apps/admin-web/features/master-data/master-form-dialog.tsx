'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select, Switch, Textarea } from '@/components/ui/fields';
import { FormField, Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api/client';
import { OWNER_TYPE_LABELS, type FieldDef, type MasterRecord, type MasterResourceConfig } from './config';

type Values = Record<string, string | number | boolean>;
type Page<T> = { items: T[]; total: number };

const initialValues = (config: MasterResourceConfig, record: MasterRecord | null): Values =>
  Object.fromEntries(
    config.fields.map((field) => {
      const current = record?.[field.name as keyof MasterRecord];
      if (field.kind === 'switch') return [field.name, typeof current === 'boolean' ? current : true];
      if (field.kind === 'number') return [field.name, typeof current === 'number' ? current : 0];
      return [field.name, typeof current === 'string' ? current : field.kind === 'ownerType' ? 'FACILITY' : ''];
    }),
  );

/** Only editable fields are sent; the key (code/slug, owner type) is fixed after creation. */
function payload(config: MasterResourceConfig, values: Values, editing: boolean) {
  return Object.fromEntries(config.fields.filter((field) => !(editing && field.createOnly)).map((field) => [field.name, values[field.name]]));
}

export function useActiveCategories(enabled: boolean) {
  return useQuery({
    queryKey: ['master', 'service-categories', 'options'],
    queryFn: () => api<Page<MasterRecord>>('/admin/master/service-categories', { query: { active: true, limit: 100, sortBy: 'name', sortOrder: 'asc' } }),
    enabled,
    staleTime: 60_000,
  });
}

export function MasterFormDialog({ config, record, open, onOpenChange }: { config: MasterResourceConfig; record: MasterRecord | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const editing = Boolean(record);
  const [values, setValues] = useState<Values>(() => initialValues(config, record));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState('');
  const categories = useActiveCategories(open && config.fields.some((field) => field.kind === 'category'));

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api<MasterRecord>(`${config.apiPath}/${record!.id}`, { method: 'PATCH', body: payload(config, values, true) })
        : api<MasterRecord>(config.apiPath, { method: 'POST', body: payload(config, values, false) }),
    onSuccess: async (saved) => {
      toast.success(editing ? `${saved.name} diperbarui` : `${saved.name} ditambahkan`);
      await queryClient.invalidateQueries({ queryKey: ['master', config.key] });
      if (config.key === 'service-categories') await queryClient.invalidateQueries({ queryKey: ['master', 'service-categories', 'options'] });
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length) {
        setFieldErrors(error.fieldErrors);
        setFormError('');
      } else {
        setFormError(error instanceof ApiError ? error.message : 'Data gagal disimpan. Coba lagi.');
      }
    },
  });

  const set = (name: string, value: string | number | boolean) => {
    setValues((current) => ({ ...current, [name]: value }));
    setFieldErrors(({ [name]: _removed, ...rest }) => rest);
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    save.mutate();
  }

  const renderField = (field: FieldDef) => {
    const value = values[field.name];
    const locked = editing && field.createOnly;
    if (field.kind === 'switch') {
      return <Switch key={field.name} label={field.label} description={field.hint} checked={Boolean(value)} onCheckedChange={(checked) => set(field.name, checked)} />;
    }
    return (
      <FormField key={field.name} label={field.label} required={field.required && !locked} error={fieldErrors[field.name]?.[0]} hint={locked ? 'Tidak bisa diubah setelah disimpan.' : field.hint}>
        {(props) =>
          field.kind === 'textarea' ? (
            <Textarea {...props} value={String(value ?? '')} maxLength={2000} onChange={(event) => set(field.name, event.target.value)} />
          ) : field.kind === 'category' ? (
            <Select {...props} required value={String(value)} disabled={categories.isLoading} onChange={(event) => set(field.name, event.target.value)}>
              <option value="" disabled>{categories.isLoading ? 'Memuat kategori...' : 'Pilih kategori'}</option>
              {record?.category && !record.category.active && <option value={record.category.id}>{record.category.name} (nonaktif)</option>}
              {(categories.data?.items ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
          ) : field.kind === 'ownerType' ? (
            <Select {...props} value={String(value)} disabled={locked} onChange={(event) => set(field.name, event.target.value)}>
              {Object.entries(OWNER_TYPE_LABELS).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
            </Select>
          ) : field.kind === 'number' ? (
            <Input {...props} type="number" inputMode="numeric" min={0} max={9999} value={String(value)} onChange={(event) => set(field.name, event.target.value === '' ? 0 : Number(event.target.value))} />
          ) : (
            <Input {...props} required={field.required} disabled={locked} placeholder={field.placeholder} value={String(value ?? '')} maxLength={160} onChange={(event) => set(field.name, event.target.value)} />
          )
        }
      </FormField>
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !save.isPending && onOpenChange(next)}
      title={editing ? `Ubah ${config.singular}` : `Tambah ${config.singular}`}
      description={editing ? `${record?.name}` : config.description}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={() => onOpenChange(false)} disabled={save.isPending}>Batal</Button>
          <Button type="submit" form="master-form" loading={save.isPending}>Simpan</Button>
        </>
      }
    >
      <form id="master-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        {config.fields.map(renderField)}
      </form>
    </Dialog>
  );
}
