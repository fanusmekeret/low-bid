import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';
import { buildSearch } from '../../src/modules/auctions/search.js';
import { formatEtb } from '../../src/utils/money.js';

describe('buildSearch', () => {
  it('requires every word and matches prefixes', () => {
    assert.deepEqual(buildSearch('samsung galaxy'), { boolean: '+samsung* +galaxy*', fallback: 'samsung galaxy' });
  });
  it('strips operators so input cannot change the query', () => {
    assert.equal(buildSearch('-iphone +"pro" (max) ~ @3 <x>').boolean, '+iphone* +pro* +max*');
    assert.equal(buildSearch("'; DROP TABLE products; --").boolean, '+DROP* +TABLE* +products*');
  });
  it('handles Amharic and Ethiopic punctuation', () => {
    assert.equal(buildSearch('ማቀዝቀዣ፣ሳምሰንግ').boolean, '+ማቀዝቀዣ* +ሳምሰንግ*');
  });
  it('falls back for short words', () => {
    assert.deepEqual(buildSearch('a5 tv'), { boolean: null, fallback: 'a5 tv' });
  });
  it('caps the number of words', () => {
    assert.equal(buildSearch('one two three four five six seven eight nine ten').boolean.split(' ').length, 8);
  });
});

describe('formatEtb', () => {
  it('formats for notifications', () => {
    assert.equal(formatEtb(16500000n), 'ETB 165,000');
    assert.equal(formatEtb(16450050n), 'ETB 164,500.50');
    assert.equal(formatEtb(5n), 'ETB 0.05');
  });
});
