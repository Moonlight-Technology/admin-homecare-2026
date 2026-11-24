'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ImageOff, ImagePlus, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert, EmptyState, ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api/client';
import { putDocumentBytes, type SignedUpload } from '@/lib/api/document-upload';
import { useAuth } from '@/lib/auth/auth-provider';
import { canFacility, canPlatform } from '@/lib/auth/types';

type MediaKind = 'LOGO' | 'PHOTO';
export type FacilityMedia = { id: string; kind: MediaKind; caption: string | null; sortOrder: number; fileName: string; mimeType: string; sizeBytes: number; url: string; expiresAt: string };
type MediaList = { maxPhotos: number; items: FacilityMedia[] };

export const ACCEPTED_MEDIA_TYPES = 'image/jpeg,image/png';
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

/**
 * The API serves files with `Cross-Origin-Resource-Policy: same-origin`, so an <img> pointing at it is blocked.
 * Fetch the short-lived signed link through CORS instead and show a local blob; the link is never stored.
 */
function SignedImage({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    fetch(url)
      .then((response) => { if (!response.ok) throw new Error('image'); return response.blob(); })
      .then((blob) => { if (cancelled) return; objectUrl = URL.createObjectURL(blob); setSrc(objectUrl); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  if (failed) return <div className={`flex flex-col items-center justify-center gap-1 bg-app text-xs text-muted ${className ?? ''}`}><ImageOff className="size-5" aria-hidden />Gambar tidak dapat dimuat</div>;
  if (!src) return <Skeleton className={className} />;
  return <img src={src} alt={alt} className={`object-cover ${className ?? ''}`} />;
}

function PhotoCard({ photo, index, count, editable, busy, onCaption, onMove, onRemove }: {
  photo: FacilityMedia; index: number; count: number; editable: boolean; busy: boolean;
  onCaption: (caption: string | null) => void; onMove: (direction: -1 | 1) => void; onRemove: () => void;
}) {
  const [caption, setCaption] = useState(photo.caption ?? '');
  useEffect(() => { setCaption(photo.caption ?? ''); }, [photo.caption]);
  const changed = caption.trim() !== (photo.caption ?? '');
  const label = photo.caption || `Foto ${index + 1}`;
  return (
    <li className="overflow-hidden rounded-lg border border-line bg-surface">
      <SignedImage url={photo.url} alt={label} className="aspect-[4/3] w-full" />
      <div className="space-y-2 p-3">
        {editable ? (
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); onCaption(caption.trim() || null); }}>
            <Input aria-label={`Keterangan ${label}`} placeholder="Keterangan (opsional)" maxLength={200} value={caption} disabled={busy} onChange={(event) => setCaption(event.target.value)} />
            {changed && <Button type="submit" size="sm" variant="secondary" disabled={busy}>Simpan</Button>}
          </form>
        ) : <p className="truncate text-sm text-ink">{photo.caption || <span className="text-muted">Tanpa keterangan</span>}</p>}
        {editable && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="ghost" aria-label={`Geser ${label} ke kiri`} disabled={busy || index === 0} onClick={() => onMove(-1)}><ArrowLeft /></Button>
              <Button type="button" size="sm" variant="ghost" aria-label={`Geser ${label} ke kanan`} disabled={busy || index === count - 1} onClick={() => onMove(1)}><ArrowRight /></Button>
            </div>
            <Button type="button" size="sm" variant="ghost" aria-label={`Hapus ${label}`} disabled={busy} onClick={onRemove}><Trash2 />Hapus</Button>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Clinic logo and photo gallery (spec §4 `/clinic/profile`). The clinic edits its own media; the platform view is
 * read-only. Media is not part of verification and stays editable while an application is under review.
 */
export function FacilityMediaPanel({ area, facilityId }: { area: 'clinic' | 'admin'; facilityId?: string }) {
  const { me } = useAuth();
  const client = useQueryClient();
  const path = area === 'clinic' ? '/clinic/profile/media' : `/admin/facilities/${facilityId}/media`;
  const allowed = area === 'clinic' ? canFacility(me, 'clinic:profile:read') : canPlatform(me, 'facility:read');
  const editable = area === 'clinic' && canFacility(me, 'clinic:profile:update');
  const key = ['facility-media', area, area === 'clinic' ? me?.facility?.facilityId : facilityId];
  // Links are signed for a few minutes: refetch only after changes or on demand, not on every focus.
  const media = useQuery({ queryKey: key, queryFn: () => api<MediaList>(path), enabled: allowed, staleTime: Infinity, refetchOnWindowFocus: false });
  const [message, setMessage] = useState('');
  const [validation, setValidation] = useState('');
  const [removing, setRemoving] = useState<FacilityMedia | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const refresh = () => client.invalidateQueries({ queryKey: key });

  const upload = useMutation({
    mutationFn: async ({ kind, file }: { kind: MediaKind; file: File }) => {
      const init = await api<{ document: { id: string }; upload: SignedUpload }>(`${path}/upload-init`, { method: 'POST', body: { kind, fileName: file.name, mimeType: file.type, sizeBytes: file.size } });
      await putDocumentBytes(init.upload, file);
      return api<FacilityMedia>(`${path}/complete`, { method: 'POST', body: { documentId: init.document.id, kind } });
    },
    onSuccess: async (_, { kind }) => { await refresh(); setMessage(kind === 'LOGO' ? 'Logo klinik disimpan.' : 'Foto ditambahkan.'); },
    onError: () => { void refresh(); },
  });
  const caption = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string | null }) => api<FacilityMedia>(`${path}/${id}`, { method: 'PATCH', body: { caption: value } }),
    onSuccess: async () => { await refresh(); setMessage('Keterangan foto disimpan.'); },
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api<MediaList>(`${path}/order`, { method: 'PUT', body: { ids } }),
    onSuccess: (data) => client.setQueryData(key, data),
    onError: () => { void refresh(); },
  });
  const remove = useMutation({
    mutationFn: (item: FacilityMedia) => api<void>(`${path}/${item.id}`, { method: 'DELETE' }),
    onSuccess: async (_, item) => { await refresh(); setRemoving(null); setMessage(item.kind === 'LOGO' ? 'Logo dihapus.' : 'Foto dihapus.'); },
  });

  if (!allowed) return null;
  const items = media.data?.items ?? [];
  const logo = items.find((item) => item.kind === 'LOGO');
  const photos = items.filter((item) => item.kind === 'PHOTO');
  const maxPhotos = media.data?.maxPhotos ?? 8;
  const busy = upload.isPending || caption.isPending || reorder.isPending || remove.isPending;
  const error = validation || upload.error?.message || caption.error?.message || reorder.error?.message || remove.error?.message;

  const reset = () => { setMessage(''); setValidation(''); upload.reset(); caption.reset(); reorder.reset(); remove.reset(); };
  const choose = (kind: MediaKind, file: File | undefined) => {
    reset();
    if (!file) return;
    if (!ACCEPTED_MEDIA_TYPES.split(',').includes(file.type)) { setValidation('Hanya gambar JPG atau PNG yang diperbolehkan.'); return; }
    if (file.size < 1 || file.size > MAX_MEDIA_BYTES) { setValidation('Ukuran gambar harus 1 byte sampai 5 MB.'); return; }
    upload.mutate({ kind, file });
  };
  const move = (index: number, direction: -1 | 1) => {
    reset();
    const ids = photos.map((photo) => photo.id);
    [ids[index], ids[index + direction]] = [ids[index + direction]!, ids[index]!];
    reorder.mutate(ids);
  };
  const fileInput = (kind: MediaKind, ref: typeof logoInput, label: string) => (
    <input ref={ref} type="file" className="sr-only" accept={ACCEPTED_MEDIA_TYPES} aria-label={label} disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; choose(kind, file); }} />
  );

  return (
    <Card>
      <CardHeader
        title="Logo dan foto klinik"
        description={editable ? `JPG atau PNG maksimal 5 MB. Satu logo dan hingga ${maxPhotos} foto. Tidak memengaruhi status verifikasi.` : 'Hanya dapat dilihat; klinik mengelola media dari profilnya.'}
      />
      <CardBody className="space-y-5 pt-0">
        {message && <Alert tone="success">{message}</Alert>}
        {error && <Alert>{error}</Alert>}
        {upload.isPending && <Alert tone="info">Mengunggah dan memvalidasi gambar… Jangan tutup halaman sebelum selesai.</Alert>}
        {media.error ? <ErrorState message={media.error.message} onRetry={() => void media.refetch()} /> : media.isLoading ? <Skeleton className="h-40" /> : (
          <>
            <section aria-label="Logo klinik" className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="size-24 shrink-0 overflow-hidden rounded-lg border border-line bg-app">
                {logo ? <SignedImage url={logo.url} alt="Logo klinik" className="size-24" /> : <div className="flex size-24 items-center justify-center text-muted"><ImagePlus className="size-6" aria-hidden /></div>}
              </div>
              <div className="min-w-0 space-y-2">
                <p className="text-sm font-semibold text-ink">Logo</p>
                <p className="text-xs text-muted">{logo ? logo.fileName : 'Belum ada logo.'}</p>
                {editable && (
                  <div className="flex flex-wrap gap-2">
                    {fileInput('LOGO', logoInput, 'Pilih file logo')}
                    <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => logoInput.current?.click()}><Upload />{logo ? 'Ganti logo' : 'Unggah logo'}</Button>
                    {logo && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { reset(); setRemoving(logo); }}><Trash2 />Hapus logo</Button>}
                  </div>
                )}
              </div>
            </section>

            <section aria-label="Foto klinik" className="space-y-3 border-t border-line pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink">Foto ({photos.length}/{maxPhotos})</p>
                {editable && (
                  <>
                    {fileInput('PHOTO', photoInput, 'Pilih file foto')}
                    <Button type="button" size="sm" variant="secondary" disabled={busy || photos.length >= maxPhotos} onClick={() => photoInput.current?.click()}><ImagePlus />Tambah foto</Button>
                  </>
                )}
              </div>
              {editable && photos.length >= maxPhotos && <p className="text-xs text-muted">Batas foto tercapai. Hapus salah satu foto untuk menambah yang baru.</p>}
              {photos.length ? (
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 desk:grid-cols-3">
                  {photos.map((photo, index) => (
                    <PhotoCard
                      key={photo.id}
                      photo={photo}
                      index={index}
                      count={photos.length}
                      editable={editable}
                      busy={busy}
                      onCaption={(value) => { reset(); caption.mutate({ id: photo.id, value }); }}
                      onMove={(direction) => move(index, direction)}
                      onRemove={() => { reset(); setRemoving(photo); }}
                    />
                  ))}
                </ul>
              ) : <EmptyState icon={ImagePlus} title="Belum ada foto" description={editable ? 'Tambahkan foto ruang tunggu, ruang periksa, atau tampak depan klinik.' : 'Klinik belum menambahkan foto.'} />}
            </section>
          </>
        )}
      </CardBody>
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => { if (!open) setRemoving(null); }}
        title={removing?.kind === 'LOGO' ? 'Hapus logo?' : 'Hapus foto?'}
        description="File akan dihapus permanen dari profil klinik."
        confirmLabel="Hapus"
        destructive
        loading={remove.isPending}
        onConfirm={() => { if (removing) remove.mutate(removing); }}
      />
    </Card>
  );
}
