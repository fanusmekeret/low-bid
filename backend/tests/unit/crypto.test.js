import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';
import { hmacSha256Hex, randomNumericCode, randomToken, safeEqualHex, sha256Hex } from '../../src/utils/crypto.js';

describe('crypto helpers', () => {
  it('makes 6-digit codes with leading zeros kept', () => {
    for (let i = 0; i < 500; i += 1) assert.match(randomNumericCode(6), /^\d{6}$/);
  });

  it('makes long URL-safe tokens', () => {
    const t = randomToken();
    assert.equal(t.length, 64);
    assert.match(t, /^[A-Za-z0-9_-]+$/);
    assert.notEqual(t, randomToken());
  });

  it('compares hashes in constant time and rejects mismatches', () => {
    const a = sha256Hex('x');
    assert.equal(safeEqualHex(a, sha256Hex('x')), true);
    assert.equal(safeEqualHex(a, sha256Hex('y')), false);
    assert.equal(safeEqualHex(a, 'short'), false);
    assert.equal(safeEqualHex(a, undefined), false);
  });

  it('binds OTP hashes to the secret', () => {
    assert.notEqual(hmacSha256Hex('secret-a', '123456'), hmacSha256Hex('secret-b', '123456'));
  });
});
