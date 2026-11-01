/**
 * File type detection from content ("magic bytes"). The client-supplied filename and MIME type are
 * never trusted: a file is accepted only if its bytes match one of the allowed formats.
 */
export type SniffedType = 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp';

const EXT: Record<SniffedType, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function sniffFileType(buf: Buffer): SniffedType | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Rejects content that a browser could interpret as markup or script even when served with an
 * image/PDF type (polyglots). Images must not contain HTML/SVG/script markers in their first 1 KiB.
 */
export function looksLikeMarkup(buf: Buffer): boolean {
  const head = buf.subarray(0, 1024).toString('latin1').toLowerCase();
  return /<(?:!doctype|html|script|svg|iframe|body|head)\b/.test(head);
}

export function extensionFor(type: SniffedType): string {
  return EXT[type];
}

/** Display-safe file name: no path components, control characters or quotes; bounded length. */
export function safeFileName(original: string | undefined, type: SniffedType): string {
  const base = (original ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = [...base]
    .filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f)
    .join('')
    .replace(/["<>|:*?]/g, '')
    .replace(/\.[^.]*$/, '')
    .trim()
    .slice(0, 80);
  return `${cleaned || 'document'}.${extensionFor(type)}`;
}
