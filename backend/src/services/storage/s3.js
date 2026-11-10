import { assertSafeKey } from './keys.js';

/**
 * S3-compatible storage (Backblaze B2, Wasabi, Cloudflare R2, MinIO, AWS S3).
 * Two buckets: a public-read one for product photos (put a CDN such as Cloudflare in front)
 * and a private one for seller documents, read only through presigned links.
 *
 * The AWS SDK is loaded on first use so local-storage installs never need it.
 */
export function createS3Storage({ endpoint, region, publicBucket, privateBucket, accessKeyId, secretAccessKey, forcePathStyle, publicBaseUrl }) {
  let sdk;
  async function load() {
    if (!sdk) {
      const [s3, presigner] = await Promise.all([import('@aws-sdk/client-s3'), import('@aws-sdk/s3-request-presigner')]);
      const client = new s3.S3Client({ endpoint, region, forcePathStyle, credentials: { accessKeyId, secretAccessKey } });
      sdk = { s3, presigner, client };
    }
    return sdk;
  }

  async function put(bucket, key, body, contentType, cacheControl) {
    const { s3, client } = await load();
    await client.send(new s3.PutObjectCommand({ Bucket: bucket, Key: assertSafeKey(key), Body: body, ContentType: contentType, CacheControl: cacheControl }));
  }

  return {
    driver: 's3',

    putPublic: (key, body, contentType = 'image/webp') => put(publicBucket, key, body, contentType, 'public, max-age=31536000, immutable'),
    putPrivate: (key, body, contentType = 'application/octet-stream') => put(privateBucket, key, body, contentType, 'private, no-store'),

    async deletePublic(keys) {
      if (keys.length === 0) return;
      const { s3, client } = await load();
      for (let i = 0; i < keys.length; i += 1000) {
        await client.send(new s3.DeleteObjectsCommand({
          Bucket: publicBucket,
          Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key: assertSafeKey(Key) })), Quiet: true },
        }));
      }
    },
    async deletePrivate(key) {
      const { s3, client } = await load();
      await client.send(new s3.DeleteObjectCommand({ Bucket: privateBucket, Key: assertSafeKey(key) }));
    },

    publicUrl: (key) => `${publicBaseUrl.replace(/\/$/, '')}/${assertSafeKey(key)}`,

    async privateUrl(key, { ttlSeconds = 300, filename } = {}) {
      const { s3, presigner, client } = await load();
      const cmd = new s3.GetObjectCommand({
        Bucket: privateBucket,
        Key: assertSafeKey(key),
        ResponseContentDisposition: filename ? `inline; filename="${filename.replace(/[^\w.-]/g, '_')}"` : undefined,
      });
      return presigner.getSignedUrl(client, cmd, { expiresIn: ttlSeconds });
    },
  };
}
