'use client';

import { useQuery } from '@tanstack/react-query';
import { api, API_URL, ApiError } from '@/lib/api/client';
import type { DocumentInfo, Option } from './types';

export type MasterOptions = { facilityTypes: Option[]; clinicClasses: Option[]; capabilities: Option[]; practitionerTypes: Option[] };

/** Active facility types, classes, capabilities, and practitioner types; public because registration happens before sign-in. */
export function useMasterOptions() {
  return useQuery({
    queryKey: ['public', 'master-options'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/public/master-options`);
      if (!response.ok) throw new ApiError(response.status, 'HTTP_ERROR', 'Pilihan data master gagal dimuat.');
      return (await response.json()) as MasterOptions;
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Three-step private upload (spec §8): register the file, PUT the bytes to the short-lived signed link, then confirm.
 * The storage key never reaches the browser.
 */
export async function uploadFacilityDocument(requirementId: string, file: File): Promise<DocumentInfo> {
  const init = await api<{ document: DocumentInfo; upload: { method: 'PUT'; url: string; headers: Record<string, string> } }>('/clinic/documents/upload-init', {
    method: 'POST',
    body: { requirementId, fileName: file.name, mimeType: file.type, sizeBytes: file.size },
  });
  const put = await fetch(init.upload.url, { method: 'PUT', headers: init.upload.headers, body: file });
  if (!put.ok) {
    const body = (await put.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(put.status, 'UPLOAD_FAILED', body?.message ?? 'File gagal diunggah.');
  }
  return api<DocumentInfo>('/clinic/documents/complete', { method: 'POST', body: { documentId: init.document.id } });
}

/** Opens a document through a fresh short-lived link (never a stored URL). */
export async function openClinicDocument(documentId: string) {
  const link = await api<{ url: string }>(`/clinic/documents/${documentId}/url`);
  window.open(link.url, '_blank', 'noopener,noreferrer');
}

/** `{ "profile.phone": [...] }` / `{ "facility.legalName": [...] }` → keys the form knows (`phone`, `legalName`). */
export function stripFieldPrefix(fields: Record<string, string[]>, prefix: string) {
  return Object.fromEntries(Object.entries(fields).filter(([key]) => key.startsWith(prefix)).map(([key, messages]) => [key.slice(prefix.length), messages]));
}

export const ACCEPTED_DOCUMENT_TYPES = 'application/pdf,image/jpeg,image/png';
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
