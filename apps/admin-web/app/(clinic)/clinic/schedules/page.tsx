'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarOff, Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert, EmptyState, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { MODE_LABELS } from '@/components/status/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Select, Switch } from '@/components/ui/fields';
import { FormField, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SLOT_LENGTHS, WEEK, type ClinicSlots, type Schedule, type ScheduleBlock } from '@/features/availability/types';
import { MODES, type FulfillmentMode } from '@/features/catalog/types';
import { useAuth } from '@/lib/auth/auth-provider';
import { canFacility } from '@/lib/auth/types';
import { api, ApiError } from '@/lib/api/client';
import { formatDate, formatTime, formatWeekdayDate, jakartaToday } from '@/lib/format';

type WindowValues = { dayOfWeek: string; startTime: string; endTime: string; slotMinutes: string; capacityPerSlot: string };

/** Add a weekly window (mode and day fixed by where it was opened) or edit one. */
function WindowDialog({ mode, schedule, day, open, onOpenChange }: { mode: FulfillmentMode; schedule: Schedule | null; day: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<WindowValues>(() => schedule
    ? { dayOfWeek: String(schedule.dayOfWeek), startTime: schedule.startTime, endTime: schedule.endTime, slotMinutes: String(schedule.slotMinutes), capacityPerSlot: String(schedule.capacityPerSlot) }
    : { dayOfWeek: String(day), startTime: '08:00', endTime: '16:00', slotMinutes: '60', capacityPerSlot: '1' });
  const save = useMutation({
    mutationFn: () => {
      const fields = { startTime: values.startTime, endTime: values.endTime, slotMinutes: Number(values.slotMinutes), capacityPerSlot: Number(values.capacityPerSlot) };
      return schedule
        ? api<Schedule>(`/clinic/schedules/${schedule.id}`, { method: 'PATCH', body: fields })
        : api<Schedule>('/clinic/schedules', { method: 'POST', body: { ...fields, mode, dayOfWeek: Number(values.dayOfWeek) } });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['clinic', 'schedules'] }); void queryClient.invalidateQueries({ queryKey: ['clinic', 'slots'] }); onOpenChange(false); },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const set = (patch: Partial<WindowValues>) => setValues((current) => ({ ...current, ...patch }));
  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)} title={schedule ? 'Ubah jam layanan' : `Tambah jam ${MODE_LABELS[mode] ?? mode}`} description="Waktu mengikuti zona waktu klinik (WIB)." footer={<><Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Simpan</Button></>}>
      <div className="space-y-4">
        {save.error && <Alert>{save.error.message}</Alert>}
        <FormField label="Hari" required>{(props) => <Select {...props} value={values.dayOfWeek} disabled={Boolean(schedule)} onChange={(event) => set({ dayOfWeek: event.target.value })}>{WEEK.map((entry) => <option key={entry.day} value={entry.day}>{entry.label}</option>)}</Select>}</FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Buka" required error={errors.startTime?.[0]}>{(props) => <Input {...props} type="time" step={300} value={values.startTime} onChange={(event) => set({ startTime: event.target.value })} />}</FormField>
          <FormField label="Tutup" required error={errors.endTime?.[0]}>{(props) => <Input {...props} type="time" step={300} value={values.endTime} onChange={(event) => set({ endTime: event.target.value })} />}</FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Panjang slot" required error={errors.slotMinutes?.[0]}>{(props) => <Select {...props} value={values.slotMinutes} onChange={(event) => set({ slotMinutes: event.target.value })}>{SLOT_LENGTHS.map((minutes) => <option key={minutes} value={minutes}>{minutes} menit</option>)}</Select>}</FormField>
          <FormField label="Kapasitas per slot" required error={errors.capacityPerSlot?.[0]} hint="Jumlah kunjungan sekaligus.">{(props) => <Input {...props} inputMode="numeric" value={values.capacityPerSlot} onChange={(event) => set({ capacityPerSlot: event.target.value.replace(/\D/g, '').slice(0, 3) })} />}</FormField>
        </div>
      </div>
    </Dialog>
  );
}

function WeeklyHours({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<FulfillmentMode>('ON_SITE');
  const [editing, setEditing] = useState<{ schedule: Schedule | null; day: number } | null>(null);
  const schedules = useQuery({ queryKey: ['clinic', 'schedules'], queryFn: () => api<Schedule[]>('/clinic/schedules') });
  const toggle = useMutation({
    mutationFn: (schedule: Schedule) => api<Schedule>(`/clinic/schedules/${schedule.id}`, { method: 'PATCH', body: { active: !schedule.active } }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['clinic', 'schedules'] }); void queryClient.invalidateQueries({ queryKey: ['clinic', 'slots'] }); },
  });
  const rows = (schedules.data ?? []).filter((schedule) => schedule.mode === mode);

  return (
    <Card>
      <CardHeader title="Jam layanan mingguan" description="Slot dibentuk dari jam ini. Jam yang tumpang tindih pada hari dan mode yang sama ditolak." action={<div className="w-44"><Select aria-label="Mode layanan" value={mode} onChange={(event) => setMode(event.target.value as FulfillmentMode)}>{MODES.map((item) => <option key={item} value={item}>{MODE_LABELS[item] ?? item}</option>)}</Select></div>} />
      <CardBody className="pt-0">
        {toggle.error && <Alert className="mt-4">{toggle.error.message}</Alert>}
        {schedules.error ? <ErrorState message={schedules.error.message} onRetry={() => void schedules.refetch()} /> : schedules.isLoading ? <div className="space-y-3 pt-4">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-12" />)}</div> : (
          <ul className="divide-y divide-line">
            {WEEK.map(({ day, label }) => {
              const windows = rows.filter((schedule) => schedule.dayOfWeek === day);
              return (
                <li key={day} className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-start">
                  <p className="w-24 shrink-0 pt-1.5 text-sm font-semibold text-ink">{label}</p>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    {!windows.length && <span className="pt-1.5 text-sm text-muted">Tutup</span>}
                    {windows.map((schedule) => (
                      <div key={schedule.id} className="flex items-center gap-2 rounded-[var(--radius-input)] border border-line px-3 py-1.5">
                        <span className={schedule.active ? 'text-sm font-medium text-ink' : 'text-sm text-muted line-through'}>{schedule.startTime}–{schedule.endTime}</span>
                        <span className="text-xs text-muted">{schedule.slotMinutes} mnt · {schedule.capacityPerSlot}/slot</span>
                        {canManage && <>
                          <button type="button" aria-label={`${schedule.active ? 'Nonaktifkan' : 'Aktifkan'} ${label} ${schedule.startTime}`} className="text-xs font-semibold text-primary-700 hover:underline" disabled={toggle.isPending} onClick={() => toggle.mutate(schedule)}>{schedule.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
                          <button type="button" aria-label={`Ubah ${label} ${schedule.startTime}`} className="text-muted hover:text-ink" onClick={() => setEditing({ schedule, day })}><Pencil className="size-3.5" /></button>
                        </>}
                      </div>
                    ))}
                    {canManage && <Button variant="ghost" size="sm" onClick={() => setEditing({ schedule: null, day })}><Plus />Tambah</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
      {editing && <WindowDialog key={editing.schedule?.id ?? `new-${editing.day}`} mode={mode} schedule={editing.schedule} day={editing.day} open onOpenChange={(open) => !open && setEditing(null)} />}
    </Card>
  );
}

type BlockValues = { mode: string; partial: boolean; startDate: string; endDate: string; startTime: string; endTime: string; reason: string };

function BlockDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<BlockValues>(() => ({ mode: '', partial: false, startDate: jakartaToday(), endDate: '', startTime: '12:00', endTime: '13:00', reason: '' }));
  const set = (patch: Partial<BlockValues>) => setValues((current) => ({ ...current, ...patch }));
  const save = useMutation({
    mutationFn: () => api<ScheduleBlock>('/clinic/schedule-blocks', {
      method: 'POST',
      body: { mode: values.mode || null, startDate: values.startDate, ...(values.partial ? { startTime: values.startTime, endTime: values.endTime } : { endDate: values.endDate || null }), reason: values.reason.trim() || null },
    }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['clinic', 'blocks'] }); void queryClient.invalidateQueries({ queryKey: ['clinic', 'slots'] }); onOpenChange(false); },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)} title="Tutup tanggal atau jam" description="Slot yang terkena blok tidak dapat dipesan." footer={<><Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Simpan</Button></>}>
      <div className="space-y-4">
        {save.error && <Alert>{save.error.message}</Alert>}
        <FormField label="Berlaku untuk">{(props) => <Select {...props} value={values.mode} onChange={(event) => set({ mode: event.target.value })}><option value="">Semua mode</option>{MODES.map((mode) => <option key={mode} value={mode}>{MODE_LABELS[mode] ?? mode} saja</option>)}</Select>}</FormField>
        <Switch label="Hanya sebagian jam" description="Matikan untuk menutup satu hari penuh atau beberapa hari." checked={values.partial} onCheckedChange={(partial) => set({ partial })} />
        <div className="grid grid-cols-2 gap-4">
          <FormField label={values.partial ? 'Tanggal' : 'Dari tanggal'} required error={errors.startDate?.[0]}>{(props) => <Input {...props} type="date" value={values.startDate} onChange={(event) => set({ startDate: event.target.value })} />}</FormField>
          {!values.partial && <FormField label="Sampai tanggal" error={errors.endDate?.[0]} hint="Kosongkan untuk satu hari.">{(props) => <Input {...props} type="date" min={values.startDate} value={values.endDate} onChange={(event) => set({ endDate: event.target.value })} />}</FormField>}
        </div>
        {values.partial && (
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Dari jam" required error={errors.startTime?.[0]}>{(props) => <Input {...props} type="time" step={300} value={values.startTime} onChange={(event) => set({ startTime: event.target.value })} />}</FormField>
            <FormField label="Sampai jam" required error={errors.endTime?.[0]}>{(props) => <Input {...props} type="time" step={300} value={values.endTime} onChange={(event) => set({ endTime: event.target.value })} />}</FormField>
          </div>
        )}
        <FormField label="Alasan" error={errors.reason?.[0]}>{(props) => <Input {...props} maxLength={200} placeholder="Libur nasional, renovasi, ..." value={values.reason} onChange={(event) => set({ reason: event.target.value })} />}</FormField>
      </div>
    </Dialog>
  );
}

/** "25 Des 2026" for whole days, "25 Des 2026, 12.00–13.00" for a time range. */
function blockLabel(block: ScheduleBlock) {
  const starts = new Date(block.startsAt);
  const ends = new Date(block.endsAt);
  const wholeDays = formatTime(starts) === '00.00' && formatTime(ends) === '00.00';
  if (!wholeDays) return `${formatDate(starts)}, ${formatTime(starts)}–${formatTime(ends)}`;
  const lastDay = new Date(ends.getTime() - 1);
  return formatDate(starts) === formatDate(lastDay) ? formatDate(starts) : `${formatDate(starts)} – ${formatDate(lastDay)}`;
}

function Blocks({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ScheduleBlock | null>(null);
  const blocks = useQuery({ queryKey: ['clinic', 'blocks'], queryFn: () => api<ScheduleBlock[]>('/clinic/schedule-blocks') });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/clinic/schedule-blocks/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setRemoving(null); void queryClient.invalidateQueries({ queryKey: ['clinic', 'blocks'] }); void queryClient.invalidateQueries({ queryKey: ['clinic', 'slots'] }); },
  });
  return (
    <Card>
      <CardHeader title="Tanggal & jam tutup" description="Libur, cuti bersama, atau jam tertentu yang tidak menerima kunjungan." action={canManage && <Button size="sm" onClick={() => setAdding(true)}><Plus />Tutup tanggal</Button>} />
      <CardBody className="pt-0">
        {blocks.error ? <ErrorState message={blocks.error.message} onRetry={() => void blocks.refetch()} /> : blocks.isLoading ? <div className="space-y-3 pt-4">{[0, 1].map((item) => <Skeleton key={item} className="h-12" />)}</div> : !blocks.data?.length ? <EmptyState icon={CalendarOff} title="Tidak ada penutupan" description="Semua jam layanan mendatang terbuka sesuai jadwal mingguan." /> : (
          <ul className="divide-y divide-line">{blocks.data.map((block) => (
            <li key={block.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
              <div><p className="font-medium text-ink">{blockLabel(block)}</p><p className="text-xs text-muted">{block.mode ? `${MODE_LABELS[block.mode] ?? block.mode} saja` : 'Semua mode'}{block.reason && ` · ${block.reason}`}</p></div>
              {canManage && <Button variant="ghost" size="sm" onClick={() => setRemoving(block)}><Trash2 />Hapus</Button>}
            </li>
          ))}</ul>
        )}
      </CardBody>
      {adding && <BlockDialog open onOpenChange={setAdding} />}
      <ConfirmDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)} title="Buka kembali jam ini?" description={removing ? `${blockLabel(removing)} akan kembali mengikuti jadwal mingguan.` : undefined} confirmLabel="Hapus penutupan" destructive loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing.id)}>{remove.error && <Alert>{remove.error.message}</Alert>}</ConfirmDialog>
    </Card>
  );
}

function SlotPreview() {
  const [mode, setMode] = useState<FulfillmentMode>('ON_SITE');
  const [from, setFrom] = useState(jakartaToday);
  const slots = useQuery({ queryKey: ['clinic', 'slots', mode, from], queryFn: () => api<ClinicSlots>('/clinic/slots', { query: { mode, from, days: 7 } }) });
  const byDay = new Map<string, ClinicSlots['slots']>();
  for (const slot of slots.data?.slots ?? []) {
    const key = formatWeekdayDate(slot.startsAt);
    byDay.set(key, [...(byDay.get(key) ?? []), slot]);
  }
  return (
    <Card>
      <CardHeader title="Pratinjau slot 7 hari" description="Kapasitas terpakai dihitung saat order disetujui; order menunggu persetujuan belum memakai kapasitas." action={<div className="flex flex-wrap gap-2"><div className="w-40"><Select aria-label="Mode" value={mode} onChange={(event) => setMode(event.target.value as FulfillmentMode)}>{MODES.map((item) => <option key={item} value={item}>{MODE_LABELS[item] ?? item}</option>)}</Select></div><Input aria-label="Mulai tanggal" type="date" value={from} onChange={(event) => event.target.value && setFrom(event.target.value)} /></div>} />
      <CardBody>
        {slots.error ? <ErrorState message={slots.error.message} onRetry={() => void slots.refetch()} /> : slots.isLoading ? <Skeleton className="h-40" /> : !byDay.size ? <EmptyState icon={Clock} title="Tidak ada slot" description="Belum ada jam layanan aktif untuk mode ini pada rentang tanggal tersebut." /> : (
          <div className="space-y-5">{[...byDay.entries()].map(([day, daySlots]) => (
            <section key={day}>
              <h3 className="mb-2 text-sm font-semibold text-ink">{day}</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">{daySlots.map((slot) => (
                <div key={slot.startsAt} className={slot.blocked ? 'rounded-[var(--radius-input)] border border-dashed border-line bg-app p-2.5 text-muted' : slot.remaining === 0 ? 'rounded-[var(--radius-input)] border border-danger/40 bg-danger-soft p-2.5' : 'rounded-[var(--radius-input)] border border-line p-2.5'}>
                  <p className="text-sm font-semibold">{formatTime(slot.startsAt)}</p>
                  <p className="text-xs">{slot.blocked ? 'Ditutup' : `${slot.remaining}/${slot.capacity} tersisa`}</p>
                  {slot.pendingOrders > 0 && <Badge tone="warning" className="mt-1">{slot.pendingOrders} menunggu</Badge>}
                </div>
              ))}</div>
            </section>
          ))}</div>
        )}
      </CardBody>
    </Card>
  );
}

export default function ClinicSchedulesPage() {
  const { me } = useAuth();
  const canManage = canFacility(me, 'schedule:manage');
  return (
    <>
      <PageHeader title="Jadwal" breadcrumbs={[{ label: 'Dashboard', href: '/clinic' }, { label: 'Jadwal' }]} description={`Jam layanan, kapasitas per slot, dan penutupan untuk ${MODES.map((mode) => MODE_LABELS[mode] ?? mode).join(' dan ')}.`} />
      <Tabs defaultValue="hours" className="space-y-4">
        <TabsList><TabsTrigger value="hours"><CalendarClock className="size-4" />Jam layanan</TabsTrigger><TabsTrigger value="blocks"><CalendarOff className="size-4" />Tutup</TabsTrigger><TabsTrigger value="preview"><Clock className="size-4" />Slot</TabsTrigger></TabsList>
        <TabsContent value="hours"><WeeklyHours canManage={canManage} /></TabsContent>
        <TabsContent value="blocks"><Blocks canManage={canManage} /></TabsContent>
        <TabsContent value="preview"><SlotPreview /></TabsContent>
      </Tabs>
    </>
  );
}

