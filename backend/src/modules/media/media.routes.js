import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import express, { Router } from 'express';
import { getStorage, mediaSigningSecret } from '../../services/storage/index.js';
import { verifyPrivateToken } from '../../services/storage/signedUrl.js';
import { notFound } from '../../utils/errors.js';

const CONTENT_TYPES = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/**
 * Public product photos for the local storage driver, mounted at /media.
 * In production, Caddy can serve the same folder directly (see deployment guide).
 */
export function publicMediaRouter() {
  const storage = getStorage();
  const router = Router();
  if (storage.driver !== 'local') return router;
  router.use(express.static(storage.publicDir, {
    immutable: true,
    maxAge: '365d',
    index: false,
    dotfiles: 'deny',
    fallthrough: false,
    setHeaders(res) {
      // Product photos are shown by the admin web app on another origin.
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  }));
  return router;
}

/**
 * Seller documents for the local storage driver: GET /api/v1/files/private/:token.
 * The token is a 5-minute HMAC-signed link minted for an admin; it names exactly one file.
 */
export function privateFilesRouter() {
  const router = Router();
  router.get('/:token', async (req, res) => {
    const storage = getStorage();
    const grant = storage.driver === 'local' ? verifyPrivateToken(mediaSigningSecret(), req.params.token) : null;
    if (!grant) throw notFound('FILE_LINK_INVALID', 'This link is invalid or has expired');

    const full = storage.resolvePrivatePath(grant.key);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) throw notFound('FILE_NOT_FOUND', 'File not found');

    const ext = path.extname(full).toLowerCase();
    const name = (grant.filename ?? path.basename(full)).replace(/[^\w.-]/g, '_');
    res.set({
      'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': String(info.size),
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      // A PDF opened from here cannot run scripts against the API's origin.
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    createReadStream(full).pipe(res);
  });
  return router;
}
