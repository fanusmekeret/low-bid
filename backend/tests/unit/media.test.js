import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, it } from 'bun:test';
import sharp from 'sharp';
import { IMAGE_SIZES, processDocument, processProductImage, variantKey } from '../../src/services/media/images.js';
import { sniffFileType } from '../../src/services/media/sniff.js';
import { assertSafeKey, newObjectId, productImageKey, sellerDocumentKey } from '../../src/services/storage/keys.js';
import { createLocalStorage } from '../../src/services/storage/local.js';
import { signPrivateToken, verifyPrivateToken } from '../../src/services/storage/signedUrl.js';

const photo = (width, height, format = 'jpeg', extra = {}) =>
  sharp({ create: { width, height, channels: 3, background: { r: 15, g: 76, b: 92 } } })[format](extra).toBuffer();

describe('sniffFileType', () => {
  it('detects real formats', async () => {
    assert.equal(sniffFileType(await photo(20, 20, 'jpeg')), 'jpeg');
    assert.equal(sniffFileType(await photo(20, 20, 'png')), 'png');
    assert.equal(sniffFileType(await photo(20, 20, 'webp')), 'webp');
    assert.equal(sniffFileType(Buffer.from('%PDF-1.7\n...%%EOF')), 'pdf');
  });
  it('ignores what the file claims to be', () => {
    assert.equal(sniffFileType(Buffer.from('<?php system($_GET[0]); ?>   ')), null);
    assert.equal(sniffFileType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
    assert.equal(sniffFileType(Buffer.alloc(4)), null);
  });
});

describe('processProductImage', () => {
  it('makes three WebP sizes and never enlarges', async () => {
    const out = await processProductImage(await photo(1000, 750));
    assert.deepEqual(out.variants.map((v) => v.size), IMAGE_SIZES.map((s) => s.name));
    assert.deepEqual(out.variants.map((v) => v.width), [320, 800, 1000]);
    for (const v of out.variants) assert.equal(sniffFileType(v.buffer), 'webp');
    assert.equal(out.width, 1000);
    assert.equal(out.height, 750);
  });

  it('strips EXIF data such as GPS location', async () => {
    const withExif = await sharp(await photo(800, 600))
      .withExif({ IFD0: { Make: 'TestPhone', Model: 'Secret Location Cam' } })
      .jpeg().toBuffer();
    assert.ok((await sharp(withExif).metadata()).exif, 'fixture should carry EXIF');
    const out = await processProductImage(withExif);
    for (const v of out.variants) assert.equal((await sharp(v.buffer).metadata()).exif, undefined);
  });

  it('turns sideways phone photos upright', async () => {
    const sideways = await sharp(await photo(900, 600)).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const out = await processProductImage(sideways);
    assert.equal(out.width, 600);
    assert.equal(out.height, 900);
  });

  it('rejects tiny images', async () => {
    await assert.rejects(processProductImage(await photo(300, 600)), (e) => e.code === 'IMAGE_TOO_SMALL');
  });

  it('rejects non-images and broken files', async () => {
    await assert.rejects(processProductImage(Buffer.from('%PDF-1.4 hello %%EOF')), (e) => e.code === 'IMAGE_TYPE_NOT_ALLOWED');
    const truncated = (await photo(800, 600)).subarray(0, 300);
    await assert.rejects(processProductImage(truncated), (e) => e.code === 'IMAGE_UNREADABLE');
  });

  it('names variants predictably', () => assert.equal(variantKey('products/4/abc', 'md'), 'products/4/abc_md.webp'));
});

describe('processDocument', () => {
  it('re-encodes ID photos to JPEG', async () => {
    const out = await processDocument(await photo(1200, 800, 'png'));
    assert.equal(out.ext, 'jpg');
    assert.equal(sniffFileType(out.buffer), 'jpeg');
  });
  it('keeps complete PDFs and rejects truncated ones', async () => {
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    assert.equal((await processDocument(pdf)).ext, 'pdf');
    await assert.rejects(processDocument(Buffer.from('%PDF-1.7\n1 0 obj')), (e) => e.code === 'DOCUMENT_UNREADABLE');
  });
});

describe('signed private links', () => {
  const secret = 'x'.repeat(64);
  it('round-trips', () => {
    const t = signPrivateToken(secret, { key: 'sellers/1/docs/a.pdf', filename: 'id.pdf' });
    assert.deepEqual(verifyPrivateToken(secret, t), { key: 'sellers/1/docs/a.pdf', filename: 'id.pdf' });
  });
  it('rejects tampering, other secrets and expiry', () => {
    const t = signPrivateToken(secret, { key: 'sellers/1/docs/a.pdf' });
    const [p, s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ k: 'sellers/2/docs/b.pdf', e: 9e9 })).toString('base64url');
    assert.equal(verifyPrivateToken(secret, `${forged}.${s}`), null);
    assert.equal(verifyPrivateToken('y'.repeat(64), t), null);
    assert.equal(verifyPrivateToken(secret, `${p}.`), null);
    assert.equal(verifyPrivateToken(secret, t, Date.now() + 301_000), null);
  });
});

describe('storage keys', () => {
  it('generates safe, unique keys', () => {
    const a = productImageKey(5n);
    assert.match(a, /^products\/5\/[a-z0-9]+$/);
    assert.notEqual(newObjectId(), newObjectId());
    assert.match(sellerDocumentKey(3, 'pdf'), /^sellers\/3\/docs\/[a-z0-9]+\.pdf$/);
  });
  it('blocks path tricks', () => {
    for (const bad of ['../etc/passwd', 'products/../../x', '/abs', 'Products/X', 'a\\b', '']) {
      assert.throws(() => assertSafeKey(bad), Error, `should reject ${JSON.stringify(bad)}`);
    }
  });
});

describe('local storage driver', () => {
  let dir;
  let storage;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'lowbid-storage-'));
    storage = createLocalStorage({ rootDir: dir, publicBaseUrl: 'http://api.test/media', privateBaseUrl: 'http://api.test/files', signingSecret: 's'.repeat(64) });
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('writes, links and deletes public files', async () => {
    await storage.putPublic('products/1/abc_sm.webp', Buffer.from('hi'));
    const file = path.join(dir, 'public/products/1/abc_sm.webp');
    assert.equal(await readFile(file, 'utf8'), 'hi');
    assert.equal(storage.publicUrl('products/1/abc_sm.webp'), 'http://api.test/media/products/1/abc_sm.webp');
    await storage.deletePublic(['products/1/abc_sm.webp']);
    assert.equal(existsSync(file), false);
  });

  it('keeps private files out of the public folder and signs links', async () => {
    await storage.putPrivate('sellers/1/docs/x.pdf', Buffer.from('%PDF'));
    assert.equal(existsSync(path.join(dir, 'public/sellers/1/docs/x.pdf')), false);
    const url = await storage.privateUrl('sellers/1/docs/x.pdf');
    assert.match(url, /^http:\/\/api\.test\/files\/[\w-]+\.[\w-]+$/);
  });
});
