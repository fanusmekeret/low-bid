import { createHmac } from 'node:crypto';
import { env } from '../../config/env.js';
import { createLocalStorage } from './local.js';
import { createS3Storage } from './s3.js';

let storage;

/** Secret for signed private links, derived so no extra env var is needed. */
export const mediaSigningSecret = () => createHmac('sha256', env.JWT_ACCESS_SECRET).update('lowbid-media-v1').digest('hex');

export function getStorage() {
  if (!storage) {
    const apiBase = env.API_PUBLIC_URL.replace(/\/$/, '');
    storage = env.STORAGE_DRIVER === 's3'
      ? createS3Storage({
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION,
          publicBucket: env.S3_PUBLIC_BUCKET,
          privateBucket: env.S3_PRIVATE_BUCKET,
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
          publicBaseUrl: env.PUBLIC_MEDIA_BASE_URL,
        })
      : createLocalStorage({
          rootDir: env.STORAGE_LOCAL_DIR,
          publicBaseUrl: env.PUBLIC_MEDIA_BASE_URL ?? `${apiBase}/media`,
          privateBaseUrl: `${apiBase}/api/v1/files/private`,
          signingSecret: mediaSigningSecret(),
        });
  }
  return storage;
}

/** Swap the storage backend (tests). */
export function setStorage(s) {
  storage = s;
}
