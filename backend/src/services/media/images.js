import sharp from 'sharp';
import { badRequest } from '../../utils/errors.js';
import { DOCUMENT_TYPES, PHOTO_TYPES, sniffFileType } from './sniff.js';

// Product photos are always re-encoded. Re-encoding drops EXIF (GPS location from phone
// cameras), colour-profile tricks and anything hidden after the image data.

export const IMAGE_SIZES = Object.freeze([
  { name: 'sm', width: 320, quality: 72 }, // cards and thumbnails
  { name: 'md', width: 800, quality: 78 }, // auction page on phones
  { name: 'lg', width: 1600, quality: 82 }, // zoom and tablets
]);

export const MIN_PHOTO_EDGE = 400; // shortest side, pixels
const MAX_INPUT_PIXELS = 50_000_000; // ~ 8K × 6K; stops decompression bombs

/** products/42/abc → products/42/abc_md.webp */
export const variantKey = (baseKey, size) => `${baseKey}_${size}.webp`;

function decodeError(err) {
  if (/heif|heic|codec|compression format/i.test(err?.message ?? '')) {
    return badRequest('IMAGE_FORMAT_UNSUPPORTED', 'This photo format is not supported. Use JPEG or PNG (on iPhone: Settings, Camera, Formats, Most Compatible)');
  }
  return badRequest('IMAGE_UNREADABLE', 'This image could not be read. Try another photo');
}

/**
 * @param {Buffer} buffer uploaded bytes
 * @returns {Promise<{ width: number, height: number, variants: { size: string, buffer: Buffer, width: number, height: number }[] }>}
 */
export async function processProductImage(buffer) {
  const type = sniffFileType(buffer);
  if (!type || !PHOTO_TYPES.has(type)) throw badRequest('IMAGE_TYPE_NOT_ALLOWED', 'Upload a JPEG, PNG or WebP photo');

  let meta;
  try {
    // .rotate() with no argument applies the camera's EXIF orientation, so photos are upright.
    meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate().metadata();
  } catch (err) {
    throw decodeError(err);
  }
  const swapped = (meta.orientation ?? 1) >= 5; // EXIF 5–8 are rotated 90°
  const width = swapped ? meta.height : meta.width;
  const height = swapped ? meta.width : meta.height;
  if (!width || !height) throw badRequest('IMAGE_UNREADABLE', 'This image could not be read. Try another photo');
  if (Math.min(width, height) < MIN_PHOTO_EDGE) {
    throw badRequest('IMAGE_TOO_SMALL', `Photos must be at least ${MIN_PHOTO_EDGE} pixels on the shortest side`, { width, height });
  }

  let variants;
  try {
    variants = await Promise.all(IMAGE_SIZES.map(async (size) => {
      const { data, info } = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate()
        .resize({ width: size.width, withoutEnlargement: true })
        .webp({ quality: size.quality, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      return { size: size.name, buffer: data, width: info.width, height: info.height };
    }));
  } catch (err) {
    throw decodeError(err);
  }
  const lg = variants.at(-1);
  return { width: lg.width, height: lg.height, variants };
}

/**
 * Seller verification documents: images are re-encoded to JPEG (max 2400 px); PDFs are kept
 * as they are but only ever served from private storage with a download disposition.
 * @returns {Promise<{ buffer: Buffer, ext: 'jpg'|'pdf', contentType: string }>}
 */
export async function processDocument(buffer) {
  const type = sniffFileType(buffer);
  if (!type || !DOCUMENT_TYPES.has(type)) throw badRequest('DOCUMENT_TYPE_NOT_ALLOWED', 'Upload a photo (JPEG, PNG) or a PDF');
  if (type === 'pdf') {
    if (!buffer.includes(Buffer.from('%%EOF'))) throw badRequest('DOCUMENT_UNREADABLE', 'This PDF looks incomplete. Try exporting it again');
    return { buffer, ext: 'pdf', contentType: 'application/pdf' };
  }
  try {
    const out = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    return { buffer: out, ext: 'jpg', contentType: 'image/jpeg' };
  } catch (err) {
    throw decodeError(err);
  }
}
