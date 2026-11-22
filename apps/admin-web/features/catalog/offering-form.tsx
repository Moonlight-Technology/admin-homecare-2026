'use client';

import { useQuery } from '@tanstack/react-query';
import { Alert } from '@/components/feedback/states';
import { MODE_LABELS } from '@/components/status/status-badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Select, Switch, Textarea } from '@/components/ui/fields';
import { FormField, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api/client';
import { formatIDR } from '@/lib/format';
import { MODE_DESCRIPTIONS, MODES, type CatalogOptions, type FulfillmentMode, type ModeValues, type OfferingValues } from './types';

const digits = (value: string) => value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 12);

/** Rupiah amount typed as whole digits, with the formatted value shown as a hint. */
function MoneyInput({ label, value, onChange, error, required, hint, disabled }: { label: string; value: string; onChange: (value: string) => void; error?: string; required?: boolean; hint?: string; disabled?: boolean }) {
  return (
    <FormField label={label} required={required} error={error} hint={value ? `${formatIDR(value)}${hint ? ` · ${hint}` : ''}` : hint}>
      {(props) => <Input {...props} inputMode="numeric" placeholder="0" disabled={disabled} value={value} onChange={(event) => onChange(digits(event.target.value))} />}
    </FormField>
  );
}

/**
 * Clinic services editor (spec §9): master service, public title, explanation, price, duration, modes with their
 * mode-specific price and homecare visit fee, and preparation instructions.
 */
export function OfferingForm({ values, onChange, errors, masterServiceLocked, disabled }: { values: OfferingValues; onChange: (patch: Partial<OfferingValues>) => void; errors: Record<string, string[]>; masterServiceLocked?: boolean; disabled?: boolean }) {
  const options = useQuery({ queryKey: ['clinic', 'offering-options'], queryFn: () => api<CatalogOptions>('/clinic/offerings/options'), staleTime: 5 * 60_000 });
  const setMode = (mode: FulfillmentMode, patch: Partial<ModeValues>) => onChange({ modes: { ...values.modes, [mode]: { ...values.modes[mode], ...patch } } });
  const modeError = (mode: FulfillmentMode, field: string) => errors[`modes.${MODES.indexOf(mode)}.${field}`]?.[0];
  const allServices = (options.data?.categories ?? []).flatMap((category) => category.masterServices.map((service) => ({ ...service, category: category.name })));
  const selected = allServices.find((service) => service.id === values.masterServiceId);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Layanan" description="Pilih layanan dari katalog platform, lalu beri judul yang dilihat pasien." />
        <CardBody className="space-y-4">
          {options.error && <Alert>Daftar layanan master gagal dimuat. Muat ulang halaman.</Alert>}
          {options.isLoading ? <Skeleton className="h-11 w-full" /> : (
            <FormField label="Layanan master" required error={errors.masterServiceId?.[0]} hint={masterServiceLocked ? 'Terkunci setelah layanan pernah dipublikasikan.' : selected?.description ?? undefined}>
              {(props) => (
                <Select {...props} value={values.masterServiceId} disabled={disabled || masterServiceLocked} onChange={(event) => {
                  const service = allServices.find((item) => item.id === event.target.value);
                  onChange({ masterServiceId: event.target.value, ...(!values.name.trim() && service ? { name: service.name } : {}) });
                }}>
                  <option value="" disabled>Pilih layanan</option>
                  {(options.data?.categories ?? []).map((category) => <optgroup key={category.id} label={category.name}>{category.masterServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</optgroup>)}
                </Select>
              )}
            </FormField>
          )}
          <FormField label="Judul untuk pasien" required error={errors.name?.[0]}>
            {(props) => <Input {...props} maxLength={160} disabled={disabled} placeholder="Cek darah lengkap di rumah" value={values.name} onChange={(event) => onChange({ name: event.target.value })} />}
          </FormField>
          <FormField label="Penjelasan" error={errors.description?.[0]}>
            {(props) => <Textarea {...props} maxLength={4000} disabled={disabled} value={values.description} onChange={(event) => onChange({ description: event.target.value })} />}
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MoneyInput label="Harga dasar" required value={values.basePrice} disabled={disabled} error={errors.basePrice?.[0]} onChange={(basePrice) => onChange({ basePrice })} />
            <FormField label="Perkiraan durasi (menit)" required error={errors.durationMinutes?.[0]} hint="5–1440 menit.">
              {(props) => <Input {...props} inputMode="numeric" disabled={disabled} value={values.durationMinutes} onChange={(event) => onChange({ durationMinutes: event.target.value.replace(/\D/g, '').slice(0, 4) })} />}
            </FormField>
          </div>
          <FormField label="Instruksi persiapan" error={errors.preparationNote?.[0]} hint="Contoh: puasa 8 jam sebelum pemeriksaan.">
            {(props) => <Textarea {...props} maxLength={2000} disabled={disabled} value={values.preparationNote} onChange={(event) => onChange({ preparationNote: event.target.value })} />}
          </FormField>
          <FormField label="Syarat & ketentuan" error={errors.terms?.[0]}>
            {(props) => <Textarea {...props} maxLength={4000} disabled={disabled} value={values.terms} onChange={(event) => onChange({ terms: event.target.value })} />}
          </FormField>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Mode layanan" description="Minimal satu mode harus aktif sebelum dipublikasikan." />
        <CardBody className="space-y-4">
          {errors.modes && <Alert>{errors.modes[0]}</Alert>}
          {MODES.map((mode) => (
            <div key={mode} className="rounded-[var(--radius-input)] border border-line p-4">
              <Switch label={MODE_LABELS[mode] ?? mode} description={MODE_DESCRIPTIONS[mode]} checked={values.modes[mode].enabled} disabled={disabled} onCheckedChange={(enabled) => setMode(mode, { enabled })} />
              {values.modes[mode].enabled && (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <MoneyInput label="Harga khusus mode ini" value={values.modes[mode].priceOverride} disabled={disabled} error={modeError(mode, 'priceOverride')} hint="Kosongkan untuk memakai harga dasar." onChange={(priceOverride) => setMode(mode, { priceOverride })} />
                  {mode === 'HOMECARE' && <MoneyInput label="Biaya kunjungan" value={values.modes[mode].visitFee} disabled={disabled} error={modeError(mode, 'visitFee')} hint="Ditambahkan sekali per kunjungan." onChange={(visitFee) => setMode(mode, { visitFee })} />}
                </div>
              )}
            </div>
          ))}
          <p className="text-xs text-muted">Aturan area layanan homecare belum tersedia; kebijakannya masih menunggu keputusan platform.</p>
        </CardBody>
      </Card>
    </div>
  );
}
