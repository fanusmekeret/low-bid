// Detects a file's real type from its first bytes. The browser-supplied MIME type and the
// file name are never trusted.

/** @param {Buffer} buf @returns {'jpeg'|'png'|'webp'|'gif'|'heic'|'pdf'|null} */
export function sniffFileType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') return 'gif';
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'pdf';
  return null;
}

export const PHOTO_TYPES = new Set(['jpeg', 'png', 'webp', 'gif', 'heic']);
export const DOCUMENT_TYPES = new Set(['jpeg', 'png', 'webp', 'heic', 'pdf']);
