'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select, Textarea } from '@/components/ui/fields';
import { FormField, Input } from '@/components/ui/input';
import { api } from '@/lib/api/client';
import type { OrderDetail } from './types';

type Slots = { timezone: string; durationMinutes: number; slots: { startsAt: string; endsAt: string; remaining: number }[] };
const localDate = (value: string, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)?.value).join('-');
};

export function RescheduleDialog({ order, open, onOpenChange, onChanged }: { order: OrderDetail; open: boolean; onOpenChange: (open: boolean) => void; onChanged: (order: OrderDetail) => void }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => localDate(order.scheduledAt, order.timezone));
  const [scheduledAt, setScheduledAt] = useState('');
  const [reason, setReason] = useState('');
  const slots = useQuery({ queryKey: ['clinic', 'order', order.id, 'reschedule-slots', date, order.version], queryFn: () => api<Slots>(`/clinic/orders/${order.id}/reschedule-slots`, { query: { date } }), enabled: open && /^\d{4}-\d{2}-\d{2}$/.test(date), retry: false });
  const move = useMutation({
    mutationFn: () => api<OrderDetail>(`/clinic/orders/${order.id}/reschedule`, { method: 'POST', body: { scheduledAt, version: order.version, reason: reason.trim() } }),
    onSuccess: (updated) => { onChanged(updated); onOpenChange(false); setReason(''); setScheduledAt(''); },
    onError: () => { void queryClient.invalidateQueries({ queryKey: ['clinic', 'order', order.id] }); void queryClient.invalidateQueries({ queryKey: ['/clinic/orders'] }); },
  });
  useEffect(() => { setScheduledAt(''); }, [order.version]);
  const display = (value: string) => new Intl.DateTimeFormat('id-ID', { timeZone: order.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const valid = reason.trim().length >= 5 && reason.trim().length <= 1000 && Boolean(slots.data?.slots.some((slot) => slot.startsAt === scheduledAt)) && !slots.isFetching;
  return <Dialog open={open} onOpenChange={(next) => { if (!move.isPending) { onOpenChange(next); if (!next) { move.reset(); setScheduledAt(''); setReason(''); } } }} title="Ubah jadwal kunjungan" description="Hanya order confirmed yang belum dimulai dan jadwal lamanya belum lewat. Harga dan pembayaran tetap; penugasan nakes diperiksa ulang." footer={<><Button variant="secondary" disabled={move.isPending} onClick={() => { onOpenChange(false); move.reset(); setScheduledAt(''); setReason(''); }}>Batal</Button><Button disabled={!valid} loading={move.isPending} onClick={() => move.mutate()}>Simpan jadwal</Button></>}>
    <div className="space-y-4">
      <p className="text-sm text-muted">Jadwal saat ini: {display(order.scheduledAt)} ({order.timezone}). Pilih slot baru dalam 60 hari.</p>
      {move.error && <Alert>{move.error.message}</Alert>}
      {slots.error && <Alert>{slots.error.message}<Button variant="ghost" size="sm" onClick={() => void slots.refetch()}>Muat ulang slot</Button></Alert>}
      <FormField label="Tanggal baru" required hint={`Tanggal lokal klinik (${order.timezone}).`}>{(props) => <Input {...props} type="date" disabled={move.isPending} value={date} onChange={(event) => { setDate(event.target.value); setScheduledAt(''); move.reset(); }} />}</FormField>
      <FormField label="Slot baru" required hint="Ketersediaan slot dan bentrok nakes diperiksa lagi saat disimpan.">{(props) => <Select {...props} value={scheduledAt} disabled={move.isPending || slots.isFetching || !slots.data?.slots.length} onChange={(event) => { setScheduledAt(event.target.value); move.reset(); }}><option value="">{slots.isFetching ? 'Memuat slot...' : 'Pilih slot baru'}</option>{slots.data?.slots.map((slot) => <option key={slot.startsAt} value={slot.startsAt}>{display(slot.startsAt)} · {slot.remaining} tempat</option>)}</Select>}</FormField>
      {slots.data && !slots.isFetching && !slots.data.slots.length && <Alert tone="info">Tidak ada slot yang cukup untuk seluruh durasi layanan pada tanggal ini. Pilih tanggal lain.</Alert>}
      <FormField label="Alasan perubahan jadwal" required hint="5–1000 karakter, tanpa data klinis pasien.">{(props) => <Textarea {...props} disabled={move.isPending} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />}</FormField>
    </div>
  </Dialog>;
}
