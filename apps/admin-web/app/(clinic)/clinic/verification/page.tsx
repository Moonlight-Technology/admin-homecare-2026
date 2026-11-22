'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileCheck2, Send, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Alert, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ACCEPTED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, openClinicDocument, uploadFacilityDocument } from '@/features/facilities/api';
import { type ClinicVerificationState, type Requirement } from '@/features/facilities/types';
import { VerificationTimeline } from '@/features/facilities/verification-timeline';
import { api } from '@/lib/api/client';

function RequirementRow({ requirement, editable, uploading, onUpload }: { requirement: Requirement; editable: boolean; uploading: boolean; onUpload: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-ink">{requirement.name}</p>{requirement.mandatory && <span className="text-xs font-medium text-danger">Wajib</span>}</div>
        {requirement.description && <p className="mt-0.5 text-sm text-muted">{requirement.description}</p>}
        {requirement.document && <p className="mt-1 truncate text-xs text-muted">{requirement.document.fileName}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        {requirement.document && <Button type="button" variant="secondary" size="sm" onClick={() => void openClinicDocument(requirement.document!.id)}><ExternalLink />Lihat</Button>}
        <input ref={input} className="sr-only" type="file" accept={ACCEPTED_DOCUMENT_TYPES} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = ''; }} />
        <Button type="button" variant="secondary" size="sm" loading={uploading} disabled={!editable} onClick={() => input.current?.click()}><Upload />{requirement.document ? 'Ganti' : 'Unggah'}</Button>
      </div>
    </li>
  );
}

export default function ClinicVerificationPage() {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [uploadingId, setUploadingId] = useState('');
  const [localError, setLocalError] = useState('');
  const state = useQuery({ queryKey: ['clinic', 'verification'], queryFn: () => api<ClinicVerificationState>('/clinic/verification') });
  const submit = useMutation({
    mutationFn: () => api('/clinic/verification/submit', { method: 'POST' }),
    onSuccess: () => { setConfirm(false); void queryClient.invalidateQueries({ queryKey: ['clinic'] }); },
  });
  async function upload(requirementId: string, file: File) {
    setLocalError('');
    if (file.size > MAX_DOCUMENT_BYTES) { setLocalError('Ukuran file maksimal 10 MB.'); return; }
    setUploadingId(requirementId);
    try { await uploadFacilityDocument(requirementId, file); await queryClient.invalidateQueries({ queryKey: ['clinic', 'verification'] }); }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'File gagal diunggah.'); }
    finally { setUploadingId(''); }
  }

  return (
    <>
      <PageHeader title="Verifikasi klinik" breadcrumbs={[{ label: 'Dashboard', href: '/clinic' }, { label: 'Verifikasi' }]} description="Lengkapi dokumen wajib, lalu kirim pengajuan untuk direview tim platform." actions={state.data && <><StatusBadge status={state.data.facility.verificationStatus} /><Button onClick={() => setConfirm(true)} disabled={!state.data.canSubmit}><Send />Kirim pengajuan</Button></>} />
      {state.error ? <Card><ErrorState message={state.error.message} onRetry={() => void state.refetch()} /></Card> : state.isLoading ? <div className="space-y-4">{[0,1,2].map((item) => <Skeleton key={item} className="h-32" />)}</div> : state.data && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
          <Card>
            <CardHeader title="Dokumen persyaratan" description="PDF, JPG, atau PNG; maksimal 10 MB per file." />
            <CardBody className="pt-0">
              {localError && <Alert className="mt-5">{localError}</Alert>}
              {state.data.facility.statusReason && <Alert tone="warning" className="mt-5">Catatan reviewer: {state.data.facility.statusReason}</Alert>}
              <ul className="divide-y divide-line">{state.data.requirements.map((requirement) => <RequirementRow key={requirement.id} requirement={requirement} editable={state.data.editable} uploading={uploadingId === requirement.id} onUpload={(file) => void upload(requirement.id, file)} />)}</ul>
              {!state.data.requirements.length && <div className="py-10 text-center text-sm text-muted"><FileCheck2 className="mx-auto mb-2 size-8" />Belum ada persyaratan dokumen aktif.</div>}
              {Object.keys(state.data.missing).length > 0 && <Alert tone="warning">Masih ada {Object.keys(state.data.missing).length} persyaratan yang perlu dilengkapi sebelum pengajuan dapat dikirim.</Alert>}
            </CardBody>
          </Card>
          <Card><CardHeader title="Riwayat pengajuan" /><CardBody><VerificationTimeline history={state.data.history} /></CardBody></Card>
        </div>
      )}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Kirim pengajuan verifikasi?" description="Profil dan dokumen akan dikunci selama proses review." confirmLabel="Kirim pengajuan" loading={submit.isPending} onConfirm={() => submit.mutate()}>{submit.error && <Alert>{submit.error.message}</Alert>}</ConfirmDialog>
    </>
  );
}
