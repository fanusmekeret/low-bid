// All money is BigInt santim (1 ETB = 100 santim). No floating point anywhere.

const ETB_PATTERN = /^(\d{1,13})(?:\.(\d{1,2}))?$/;

/**
 * "1250.5" → 125050n. Rejects negatives, more than 2 decimals, and non-numeric input.
 * @param {string | number | bigint} value ETB amount
 * @returns {bigint}
 */
export function etbToMinor(value) {
  if (typeof value === 'bigint') return value * 100n;
  const text = String(value).trim();
  const m = text.match(ETB_PATTERN);
  if (!m) throw new RangeError(`Invalid ETB amount: ${text}`);
  const whole = BigInt(m[1]);
  const fraction = BigInt((m[2] || '').padEnd(2, '0'));
  return whole * 100n + fraction;
}

/**
 * 125050n → "1250.50"
 * @param {bigint | number | string} minor
 */
export function minorToEtb(minor) {
  const v = BigInt(minor);
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const text = `${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

/**
 * Percentage in basis points, rounded half-up. applyBasisPoints(100000n, 1000) = 10000n (10%).
 * @param {bigint} amount santim, non-negative
 * @param {number} basisPoints 0–10000
 */
export function applyBasisPoints(amount, basisPoints) {
  if (amount < 0n) throw new RangeError('amount must be non-negative');
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) {
    throw new RangeError('basisPoints must be an integer from 0 to 10000');
  }
  return (amount * BigInt(basisPoints) + 5000n) / 10000n;
}

/** 16450050n → "ETB 164,500.50"; whole amounts drop the decimals: "ETB 165,000". */
export function formatEtb(minor) {
  const v = BigInt(minor);
  const whole = (v / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = v % 100n;
  return `ETB ${whole}${cents === 0n ? '' : `.${cents.toString().padStart(2, '0')}`}`;
}

/** API shape for an amount: exact integer string plus a display string. */
export function moneyDto(minor) {
  if (minor === null || minor === undefined) return null;
  return { minor: BigInt(minor).toString(), etb: minorToEtb(minor), currency: 'ETB' };
}
