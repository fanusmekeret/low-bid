import { createHmac, timingSafeEqual } from 'node:crypto';

// Short-lived signed links for private files (seller ID documents) when using local storage.
// Token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload)).

const b64 = (buf) => Buffer.from(buf).toString('base64url');

/**
 * @param {string} secret
 * @param {{ key: string, filename?: string, ttlSeconds?: number, now?: number }} opts
 */
export function signPrivateToken(secret, { key, filename, ttlSeconds = 300, now = Date.now() }) {
  const payload = b64(JSON.stringify({ k: key, f: filename, e: Math.floor(now / 1000) + ttlSeconds }));
  const sig = b64(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

/**
 * @returns {{ key: string, filename?: string } | null} null when the token is malformed, forged or expired
 */
export function verifyPrivateToken(secret, token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  let given;
  try { given = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (typeof data?.k !== 'string' || typeof data?.e !== 'number') return null;
  if (data.e * 1000 < now) return null;
  return { key: data.k, filename: typeof data.f === 'string' ? data.f : undefined };
}
