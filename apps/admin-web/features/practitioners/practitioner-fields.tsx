'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Alert } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/fields';
import { FormField, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useMasterOptions } from '@/features/facilities/api';
import { CREDENTIAL_LABELS, emptyCredential, type CredentialValues, type PractitionerValues } from './types';

/** One credential: type, number, issuer, validity. `errors` keys are relative (`number`, `validUntil`). */
export function CredentialFields({ values, onChange, errors, lockType }: { values: CredentialValues; onChange: (patch: Partial<CredentialValues>) => void; errors: Record<string, string[]>; lockType?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
      <FormField label="Jenis" required error={errors.credentialType?.[0]}>
        {(props) => (
          <Select {...props} value={values.credentialType} disabled={lockType} onChange={(event) => onChange({ credentialType: event.target.value as CredentialValues['credentialType'] })}>
            {Object.entries(CREDENTIAL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        )}
      </FormField>
      <FormField label="Nomor" required error={errors.number?.[0]} hint="Disimpan terenkripsi; hanya 4 karakter terakhir yang ditampilkan.">
        {(props) => <Input {...props} autoComplete="off" spellCheck={false} maxLength={60} value={values.number} onChange={(event) => onChange({ number: event.target.value })} />}
      </FormField>
      <div className="sm:col-span-2">
        <FormField label="Penerbit" error={errors.issuingAuthority?.[0]}>
          {(props) => <Input {...props} placeholder="Konsil Kedokteran Indonesia / Dinas Kesehatan" maxLength={200} value={values.issuingAuthority} onChange={(event) => onChange({ issuingAuthority: event.target.value })} />}
        </FormField>
      </div>
      <FormField label="Berlaku dari" error={errors.validFrom?.[0]}>
        {(props) => <Input {...props} type="date" value={values.validFrom} onChange={(event) => onChange({ validFrom: event.target.value })} />}
      </FormField>
      <FormField label="Berlaku sampai" error={errors.validUntil?.[0]} hint="Kosongkan bila berlaku seumur hidup.">
        {(props) => <Input {...props} type="date" value={values.validUntil} onChange={(event) => onChange({ validUntil: event.target.value })} />}
      </FormField>
    </div>
  );
}

/** Errors for `credentials.<index>.<field>` → `{ field: messages }` for that row. */
const rowErrors = (errors: Record<string, string[]>, index: number) => {
  const prefix = `credentials.${index}.`;
  return Object.fromEntries(Object.entries(errors).filter(([key]) => key.startsWith(prefix)).map(([key, messages]) => [key.slice(prefix.length), messages]));
};

/** Practitioner identity plus credentials (at least one STR). Used by admin creation and clinic registration. */
export function PractitionerFields({ values, onChange, errors }: { values: PractitionerValues; onChange: (patch: Partial<PractitionerValues>) => void; errors: Record<string, string[]> }) {
  const options = useMasterOptions();
  if (options.isLoading) return <div className="space-y-3">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-11 w-full" />)}</div>;
  if (options.error) return <Alert>Pilihan jenis tenaga kesehatan gagal dimuat. Muat ulang halaman.</Alert>;
  const practitionerTypes = options.data?.practitionerTypes ?? [];
  const updateCredential = (index: number, patch: Partial<CredentialValues>) => onChange({ credentials: values.credentials.map((credential, at) => (at === index ? { ...credential, ...patch } : credential)) });

  return (
    <div className="space-y-6">
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-ink">Identitas</legend>
        <FormField label="Nama lengkap dengan gelar" required error={errors.fullName?.[0]}>
          {(props) => <Input {...props} maxLength={160} placeholder="dr. Rina Kusuma" value={values.fullName} onChange={(event) => onChange({ fullName: event.target.value })} />}
        </FormField>
        <FormField label="Jenis tenaga kesehatan" required error={errors.practitionerTypeId?.[0]}>
          {(props) => (
            <Select {...props} value={values.practitionerTypeId} onChange={(event) => onChange({ practitionerTypeId: event.target.value })}>
              <option value="" disabled>Pilih jenis</option>
              {practitionerTypes.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </Select>
          )}
        </FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Telepon" error={errors.phone?.[0]}>
            {(props) => <Input {...props} type="tel" inputMode="tel" value={values.phone} onChange={(event) => onChange({ phone: event.target.value })} />}
          </FormField>
          <FormField label="Email" error={errors.email?.[0]}>
            {(props) => <Input {...props} type="email" value={values.email} onChange={(event) => onChange({ email: event.target.value })} />}
          </FormField>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-ink">Kredensial <span className="text-danger" aria-hidden>*</span></legend>
        <p className="-mt-3 text-xs text-muted">STR yang masih berlaku wajib ada. SIP dapat ditambahkan per tempat praktik.</p>
        {errors.credentials && <Alert>{errors.credentials[0]}</Alert>}
        {values.credentials.map((credential, index) => (
          <div key={index} className="space-y-3 rounded-[var(--radius-input)] border border-line p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">Kredensial {index + 1}</p>
              {values.credentials.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ credentials: values.credentials.filter((_, at) => at !== index) })}><Trash2 />Hapus</Button>}
            </div>
            <CredentialFields values={credential} onChange={(patch) => updateCredential(index, patch)} errors={rowErrors(errors, index)} />
          </div>
        ))}
        {values.credentials.length < 10 && <Button type="button" variant="secondary" size="sm" onClick={() => onChange({ credentials: [...values.credentials, emptyCredential('SIP')] })}><Plus />Tambah kredensial</Button>}
      </fieldset>
    </div>
  );
}
