/**
 * Normalize an Ethiopian mobile number to E.164 (+2519XXXXXXXX or +2517XXXXXXXX).
 * Accepts 0912345678, 912345678, 251912345678, +251 91 234 5678, 0712345678 (Safaricom).
 * @param {unknown} input
 * @returns {string | null}
 */
export function normalizeEthiopianPhone(input) {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const compact = String(input).replace(/[\s\-().]/g, '');
  const match = compact.match(/^(?:\+?251|0)?([79]\d{8})$/);
  return match ? `+251${match[1]}` : null;
}

/** +251912345678 → +251 9** *** 678 (for showing where an OTP was sent). */
export function maskPhone(e164) {
  if (!e164 || e164.length < 7) return e164;
  return `${e164.slice(0, 5)}** *** ${e164.slice(-3)}`;
}
