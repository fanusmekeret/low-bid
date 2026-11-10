import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertSafeKey } from './keys.js';
import { signPrivateToken } from './signedUrl.js';

/**
 * Stores files on this server's disk:
 *   <rootDir>/public/...   product photos, served at publicBaseUrl
 *   <rootDir>/private/...  seller documents, only reachable through short-lived signed links
 *
 * @param {{ rootDir: string, publicBaseUrl: string, privateBaseUrl: string, signingSecret: string }} opts
 */
export function createLocalStorage({ rootDir, publicBaseUrl, privateBaseUrl, signingSecret }) {
  const root = path.resolve(rootDir);
  const publicDir = path.join(root, 'public');
  const privateDir = path.join(root, 'private');

  function resolveIn(dir, key) {
    assertSafeKey(key);
    const full = path.resolve(dir, key);
    if (!full.startsWith(dir + path.sep)) throw new Error(`Key escapes storage root: ${key}`);
    return full;
  }

  async function put(dir, key, body) {
    const full = resolveIn(dir, key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body, { mode: 0o640 });
  }

  return {
    driver: 'local',
    publicDir,
    privateDir,
    resolvePrivatePath: (key) => resolveIn(privateDir, key),

    putPublic: (key, body) => put(publicDir, key, body),
    putPrivate: (key, body) => put(privateDir, key, body),

    async deletePublic(keys) {
      await Promise.all(keys.map((k) => rm(resolveIn(publicDir, k), { force: true })));
    },
    async deletePrivate(key) {
      await rm(resolveIn(privateDir, key), { force: true });
    },

    publicUrl: (key) => `${publicBaseUrl.replace(/\/$/, '')}/${assertSafeKey(key)}`,

    /** Signed link valid for ttlSeconds (default 5 minutes). */
    async privateUrl(key, { ttlSeconds = 300, filename } = {}) {
      assertSafeKey(key);
      return `${privateBaseUrl.replace(/\/$/, '')}/${signPrivateToken(signingSecret, { key, filename, ttlSeconds })}`;
    },
  };
}
