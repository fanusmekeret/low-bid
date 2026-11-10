import { getStorage } from '../storage/index.js';
import { productImageKey } from '../storage/keys.js';
import { IMAGE_SIZES, processProductImage, variantKey } from './images.js';

/** URLs for every size of one stored photo. */
export function imageUrls(baseKey) {
  const storage = getStorage();
  return Object.fromEntries(IMAGE_SIZES.map((s) => [s.name, storage.publicUrl(variantKey(baseKey, s.name))]));
}

export const allVariantKeys = (baseKeys) => baseKeys.flatMap((k) => IMAGE_SIZES.map((s) => variantKey(k, s.name)));

/**
 * Processes and stores photos. All-or-nothing: if any photo is rejected, files already
 * written for this request are removed and the error names the photo.
 * @param {bigint|string} productId
 * @param {{ buffer: Buffer, originalname?: string }[]} files
 * @returns {Promise<{ key: string, width: number, height: number }[]>}
 */
export async function storeProductImages(productId, files) {
  const storage = getStorage();
  const written = []; // base keys with at least one file on storage
  const results = [];
  try {
    for (const [index, file] of files.entries()) {
      let processed;
      try {
        processed = await processProductImage(file.buffer);
      } catch (err) {
        err.details = { ...(err.details ?? {}), fileIndex: index, fileName: file.originalname };
        throw err;
      }
      const key = productImageKey(productId);
      written.push(key);
      await Promise.all(processed.variants.map((v) => storage.putPublic(variantKey(key, v.size), v.buffer, 'image/webp')));
      results.push({ key, width: processed.width, height: processed.height });
    }
    return results;
  } catch (err) {
    await storage.deletePublic(allVariantKeys(written)).catch(() => {});
    throw err;
  }
}

export async function deleteProductImageFiles(baseKeys) {
  if (baseKeys.length) await getStorage().deletePublic(allVariantKeys(baseKeys));
}
