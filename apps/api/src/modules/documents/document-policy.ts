/**
 * Upload restrictions for verification documents (spec §8, §10): a short MIME allow-list, a size cap, and a check
 * that the file content really is that type (the declared MIME type alone is client-controlled).
 */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const SIGNATURES: Record<string, number[][]> = {
  'application/pdf': [[0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
};

export const ALLOWED_DOCUMENT_TYPES = Object.keys(SIGNATURES);

export const isAllowedDocumentType = (mimeType: string) => mimeType in SIGNATURES;

/** True when the first bytes match the declared type. */
export function matchesSignature(mimeType: string, head: Buffer): boolean {
  return (SIGNATURES[mimeType] ?? []).some((signature) => signature.every((byte, index) => head[index] === byte));
}

/** File name safe for Content-Disposition: no path parts, control characters, or quotes. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'dokumen';
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim().slice(0, 150);
  return cleaned || 'dokumen';
}
