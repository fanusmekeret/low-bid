import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';
import { maskPhone, normalizeEthiopianPhone } from '../../src/utils/phone.js';

describe('normalizeEthiopianPhone', () => {
  const valid = [
    ['0912345678', '+251912345678'],
    ['912345678', '+251912345678'],
    ['251912345678', '+251912345678'],
    ['+251912345678', '+251912345678'],
    ['+251 91 234 5678', '+251912345678'],
    ['091-234-5678', '+251912345678'],
    ['0712345678', '+251712345678'], // Safaricom Ethiopia
  ];
  for (const [input, expected] of valid) {
    it(`accepts ${input}`, () => assert.equal(normalizeEthiopianPhone(input), expected));
  }

  const invalid = ['', '0812345678', '09123456', '091234567890', '+254712345678', 'abc', null, undefined, {}];
  for (const input of invalid) {
    it(`rejects ${JSON.stringify(input)}`, () => assert.equal(normalizeEthiopianPhone(input), null));
  }
});

describe('maskPhone', () => {
  it('hides the middle digits', () => assert.equal(maskPhone('+251912345678'), '+2519** *** 678'));
});
