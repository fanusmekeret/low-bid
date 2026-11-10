import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';
import { applyBasisPoints, etbToMinor, minorToEtb, moneyDto } from '../../src/utils/money.js';

describe('etbToMinor', () => {
  it('converts whole birr', () => assert.equal(etbToMinor('50'), 5000n));
  it('converts one decimal', () => assert.equal(etbToMinor('1250.5'), 125050n));
  it('converts two decimals', () => assert.equal(etbToMinor('0.05'), 5n));
  it('accepts numbers', () => assert.equal(etbToMinor(12), 1200n));
  it('accepts bigint birr', () => assert.equal(etbToMinor(3n), 300n));
  it('handles large values exactly', () => assert.equal(etbToMinor('9999999999999.99'), 999999999999999n));
  for (const bad of ['-1', '1.234', '1e5', 'abc', '', '1,000']) {
    it(`rejects ${JSON.stringify(bad)}`, () => assert.throws(() => etbToMinor(bad), RangeError));
  }
});

describe('minorToEtb', () => {
  it('formats with two decimals', () => assert.equal(minorToEtb(125050n), '1250.50'));
  it('pads small amounts', () => assert.equal(minorToEtb(5n), '0.05'));
  it('formats negatives', () => assert.equal(minorToEtb(-150n), '-1.50'));
  it('round-trips', () => assert.equal(minorToEtb(etbToMinor('42.07')), '42.07'));
});

describe('applyBasisPoints', () => {
  it('takes 10% commission', () => assert.equal(applyBasisPoints(100000n, 1000), 10000n));
  it('rounds half up', () => assert.equal(applyBasisPoints(5n, 1000), 1n)); // 0.5 santim → 1
  it('rounds down below half', () => assert.equal(applyBasisPoints(4n, 1000), 0n));
  it('handles 0%', () => assert.equal(applyBasisPoints(123456n, 0), 0n));
  it('handles 100%', () => assert.equal(applyBasisPoints(123456n, 10000), 123456n));
  it('rejects fractional basis points', () => assert.throws(() => applyBasisPoints(100n, 10.5), RangeError));
  it('rejects negative amounts', () => assert.throws(() => applyBasisPoints(-1n, 100), RangeError));
});

describe('moneyDto', () => {
  it('returns exact minor string and display', () =>
    assert.deepEqual(moneyDto(125050n), { minor: '125050', etb: '1250.50', currency: 'ETB' }));
  it('passes null through', () => assert.equal(moneyDto(null), null));
});
