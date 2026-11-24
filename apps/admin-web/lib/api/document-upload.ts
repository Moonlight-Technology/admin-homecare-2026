import { ApiError } from './client';

export type SignedUpload = { method: 'PUT'; url: string; headers: Record<string, string> };

/** Raw bytes to a short-lived private upload URL; never multipart or a persistent/public object URL. */
export async function putDocumentBytes(upload: SignedUpload, file: File) {
  const response = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(response.status, 'UPLOAD_FAILED', body?.message ?? 'File gagal diunggah.');
  }
}
