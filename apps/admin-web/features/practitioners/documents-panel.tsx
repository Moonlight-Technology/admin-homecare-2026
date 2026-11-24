'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert, EmptyState, ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ACCEPTED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from '@/features/facilities/api';
import { api } from '@/lib/api/client';
import { putDocumentBytes, type SignedUpload } from '@/lib/api/document-upload';
import { useAuth } from '@/lib/auth/auth-provider';
import { canFacility, canPlatform } from '@/lib/auth/types';
import { formatDateTime } from '@/lib/format';

type Scan = { id: string; fileName: string; mimeType: string; sizeBytes: number; status: string; uploadedAt: string | null };
type DocumentCredential = { id: string; credentialType: string; numberMasked: string; document: Scan | null };
type DocumentState = { practitionerId: string; verificationStatus: string; editable: boolean; credentials: DocumentCredential[] };

function CredentialDocument({ credential, editable, pending, upload, open }: { credential: DocumentCredential; editable: boolean; pending: boolean; upload: (file: File) => void; open: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <li className="space-y-3 py-4">
    <p className="break-words text-sm font-semibold text-ink">{credential.credentialType} · {credential.numberMasked}</p>
    {credential.document ? <div className="space-y-1 text-xs text-muted"><p className="break-all">{credential.document.fileName}</p><p>{Math.ceil(credential.document.sizeBytes / 1024)} KB · {credential.document.uploadedAt ? formatDateTime(credential.document.uploadedAt) : 'Belum selesai diunggah'}</p></div> : <p className="text-xs text-muted">Scan belum diunggah.</p>}
    <div className="flex flex-wrap gap-2">
      {credential.document && <Button variant="secondary" size="sm" disabled={pending} onClick={open} aria-label={`Buka scan ${credential.credentialType} ${credential.numberMasked}`}><ExternalLink />Lihat scan</Button>}
      {editable && <><input ref={input} type="file" className="sr-only" accept={ACCEPTED_DOCUMENT_TYPES} aria-label={`Pilih scan ${credential.credentialType} ${credential.numberMasked}`} disabled={pending} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) upload(file); }} /><Button variant="secondary" size="sm" disabled={pending} onClick={() => input.current?.click()}><Upload />{credential.document ? `Ganti scan ${credential.credentialType}` : `Unggah scan ${credential.credentialType}`}</Button></>}
    </div>
  </li>;
}

/** Shared by the platform reviewer and the clinic that registered the practitioner; server enforces ownership. */
export function PractitionerDocumentsPanel({ practitionerId, area, onBusyChange }: { practitionerId: string; area: 'admin' | 'clinic'; onBusyChange?: (busy: boolean) => void }) {
  const { me } = useAuth();
  const client = useQueryClient();
  const facilityId = area === 'clinic' ? me?.facility?.facilityId : null;
  const allowed = area === 'admin' ? canPlatform(me, 'practitioner:review') : canFacility(me, 'affiliation:manage');
  const base = `/${area}/practitioners/${practitionerId}`;
  const key = ['practitioner-documents', area, facilityId, practitionerId];
  const state = useQuery({ queryKey: key, queryFn: () => api<DocumentState>(`${base}/documents`), enabled: allowed });
  const [message, setMessage] = useState('');
  const [validation, setValidation] = useState('');
  const upload = useMutation({
    mutationFn: async ({ credentialId, file }: { credentialId: string; file: File }) => {
      const path = `${base}/credentials/${credentialId}/documents`;
      const init = await api<{ document: Scan; upload: SignedUpload }>(`${path}/upload-init`, { method: 'POST', body: { fileName: file.name, mimeType: file.type, sizeBytes: file.size } });
      await putDocumentBytes(init.upload, file);
      return api<Scan>(`${path}/complete`, { method: 'POST', body: { documentId: init.document.id } });
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: key }); setMessage('Scan berhasil diunggah. Status verifikasi tidak diubah otomatis.'); },
    onError: () => { void client.invalidateQueries({ queryKey: key }); },
  });
  const open = useMutation({ mutationFn: async (credential: DocumentCredential) => {
    // Open synchronously for mobile popup blockers; never place the signed URL in persistent query state.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const link = await api<{ url: string }>(`${base}/credentials/${credential.id}/documents/${credential.document!.id}/url`);
      if (tab) tab.location.replace(link.url);
      else throw new Error('Izinkan tab baru untuk membuka scan dokumen.');
    } catch (error) { tab?.close(); throw error; }
  } });
  useEffect(() => { onBusyChange?.(upload.isPending); }, [upload.isPending, onBusyChange]);
  const choose = (credentialId: string, file: File) => {
    setMessage(''); setValidation(''); upload.reset(); open.reset();
    if (!ACCEPTED_DOCUMENT_TYPES.split(',').includes(file.type)) { setValidation('Hanya PDF, JPG, atau PNG yang diperbolehkan.'); return; }
    if (file.size < 1 || file.size > MAX_DOCUMENT_BYTES) { setValidation('Ukuran file harus 1 byte sampai 10 MB.'); return; }
    upload.mutate({ credentialId, file });
  };
  if (!allowed) return null;
  return <Card><CardHeader title="Scan STR / SIP" description="PDF, JPG, atau PNG maksimal 10 MB. Dokumen privat; akses scan dicatat di audit log." /><CardBody className="space-y-3 pt-0">
    {message && <Alert tone="success">{message}</Alert>}
    {(validation || upload.error || open.error) && <Alert>{validation || upload.error?.message || open.error?.message}</Alert>}
    {upload.isPending && <Alert tone="info">Mengunggah dan memvalidasi scan… Jangan tutup halaman sebelum selesai.</Alert>}
    {state.error ? <ErrorState message={state.error.message} onRetry={() => void state.refetch()} /> : state.isLoading ? <Skeleton className="h-32" /> : state.data && <>
      {!state.data.editable && <Alert tone="info">Dokumen terkunci saat sedang direview atau sudah terverifikasi. Scan existing tetap dapat dilihat.</Alert>}
      {state.data.credentials.length ? <ul className="divide-y divide-line">{state.data.credentials.map((credential) => <CredentialDocument key={credential.id} credential={credential} editable={state.data.editable} pending={upload.isPending || open.isPending} upload={(file) => choose(credential.id, file)} open={() => { open.reset(); open.mutate(credential); }} />)}</ul> : <EmptyState title="Belum ada kredensial" description="Tambahkan kredensial STR/SIP terlebih dahulu." />}
    </>}
  </CardBody></Card>;
}
