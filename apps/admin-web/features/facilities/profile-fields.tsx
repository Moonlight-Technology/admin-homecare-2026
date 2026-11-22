'use client';

import { Check } from 'lucide-react';
import { Alert } from '@/components/feedback/states';
import { Select, Textarea } from '@/components/ui/fields';
import { FormField, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useMasterOptions } from './api';
import type { ProfileValues } from './types';

type Props = {
  values: ProfileValues;
  onChange: (patch: Partial<ProfileValues>) => void;
  errors: Record<string, string[]>;
  /** Fields the current user may not change (e.g. verified legal identity for a clinic). */
  locked?: Array<keyof ProfileValues>;
  disabled?: boolean;
};

/** Clinic profile inputs (spec §4 Profile): identity, classification, capabilities, contact, address. */
export function ProfileFields({ values, onChange, errors, locked = [], disabled }: Props) {
  const options = useMasterOptions();
  const isLocked = (field: keyof ProfileValues) => disabled || locked.includes(field);
  const lockedHint = (field: keyof ProfileValues) => (locked.includes(field) ? 'Terkunci setelah terverifikasi; hubungi admin platform untuk mengubah.' : undefined);

  if (options.isLoading) return <div className="space-y-3">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-11 w-full" />)}</div>;
  if (options.error) return <Alert>Pilihan jenis, kelas, dan kapabilitas gagal dimuat. Muat ulang halaman.</Alert>;
  const { facilityTypes = [], clinicClasses = [], capabilities = [] } = options.data ?? {};

  return (
    <div className="space-y-6">
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-ink">Identitas klinik</legend>
        <FormField label="Nama tampilan" required error={errors.displayName?.[0]} hint="Nama yang dilihat pelanggan.">
          {(props) => <Input {...props} value={values.displayName} disabled={isLocked('displayName')} maxLength={160} onChange={(event) => onChange({ displayName: event.target.value })} />}
        </FormField>
        <FormField label="Nama legal" required error={errors.legalName?.[0]} hint={lockedHint('legalName') ?? 'Sesuai izin atau akta badan usaha.'}>
          {(props) => <Input {...props} value={values.legalName} disabled={isLocked('legalName')} maxLength={200} onChange={(event) => onChange({ legalName: event.target.value })} />}
        </FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Jenis fasilitas" required error={errors.facilityTypeId?.[0]} hint={lockedHint('facilityTypeId')}>
            {(props) => (
              <Select {...props} value={values.facilityTypeId} disabled={isLocked('facilityTypeId')} onChange={(event) => onChange({ facilityTypeId: event.target.value })}>
                <option value="" disabled>Pilih jenis</option>
                {facilityTypes.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Kelas klinik" error={errors.clinicClassId?.[0]} hint={lockedHint('clinicClassId')}>
            {(props) => (
              <Select {...props} value={values.clinicClassId} disabled={isLocked('clinicClassId')} onChange={(event) => onChange({ clinicClassId: event.target.value })}>
                <option value="">Tidak ada / belum ditentukan</option>
                {clinicClasses.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </Select>
            )}
          </FormField>
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-sm font-semibold text-ink">Kapabilitas layanan <span className="text-danger" aria-hidden>*</span></legend>
        <p className="mb-3 text-xs text-muted">Pilih minimal satu. Terpisah dari kelas klinik.</p>
        <div className="flex flex-wrap gap-2" role="group" aria-describedby={errors.capabilityIds ? 'capability-error' : undefined}>
          {capabilities.map((option) => {
            const checked = values.capabilityIds.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                role="checkbox"
                aria-checked={checked}
                disabled={disabled}
                onClick={() => onChange({ capabilityIds: checked ? values.capabilityIds.filter((id) => id !== option.id) : [...values.capabilityIds, option.id] })}
                className={cn('inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium ring-1 transition-colors disabled:opacity-55', checked ? 'bg-primary-50 text-primary-700 ring-primary-500' : 'bg-surface text-muted ring-line hover:text-ink')}
              >
                <span className={cn('flex size-4 items-center justify-center rounded border', checked ? 'border-primary-500 bg-primary-500 text-white' : 'border-line')}>{checked && <Check className="size-3" />}</span>
                {option.name}
              </button>
            );
          })}
        </div>
        {errors.capabilityIds && <p id="capability-error" className="mt-1.5 text-xs text-danger">{errors.capabilityIds[0]}</p>}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-ink">Kontak & alamat</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Telepon klinik" required error={errors.phone?.[0]}>
            {(props) => <Input {...props} type="tel" inputMode="tel" autoComplete="tel" placeholder="021-5550123" value={values.phone} disabled={isLocked('phone')} onChange={(event) => onChange({ phone: event.target.value })} />}
          </FormField>
          <FormField label="Email klinik" error={errors.email?.[0]}>
            {(props) => <Input {...props} type="email" autoComplete="email" value={values.email} disabled={isLocked('email')} onChange={(event) => onChange({ email: event.target.value })} />}
          </FormField>
        </div>
        <FormField label="Alamat lengkap" required error={errors.addressLine?.[0]} hint="Satu lokasi fisik klinik.">
          {(props) => <Textarea {...props} value={values.addressLine} disabled={isLocked('addressLine')} maxLength={500} onChange={(event) => onChange({ addressLine: event.target.value })} />}
        </FormField>
        <div className="sm:w-48">
          <FormField label="Kode pos" error={errors.postalCode?.[0]}>
            {(props) => <Input {...props} inputMode="numeric" maxLength={5} value={values.postalCode} disabled={isLocked('postalCode')} onChange={(event) => onChange({ postalCode: event.target.value.replace(/\D/g, '') })} />}
          </FormField>
        </div>
      </fieldset>
    </div>
  );
}
