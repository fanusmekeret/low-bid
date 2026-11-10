import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

export const hmacSha256Hex = (secret, value) => createHmac('sha256', secret).update(value).digest('hex');

/** Opaque random token, URL-safe. 48 bytes → 64 chars. */
export const randomToken = (bytes = 48) => randomBytes(bytes).toString('base64url');

/** Uniform 6-digit numeric code, leading zeros kept. */
export const randomNumericCode = (digits = 6) => String(randomInt(0, 10 ** digits)).padStart(digits, '0');

/** Constant-time comparison of two hex strings. */
export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
