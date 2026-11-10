import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

// Thin client for Chapa's REST API (https://developer.chapa.co). The secret key is only ever
// sent from this server to api.chapa.co. Every call returns { httpStatus, body } so callers
// decide what a 404 means (e.g. "not paid yet" during verification).

export class ChapaUnavailableError extends AppError {
  constructor(message, details) {
    super(503, 'PAYMENT_PROVIDER_UNAVAILABLE', message, details);
  }
}

function requireKey() {
  if (!env.CHAPA_SECRET_KEY) throw new ChapaUnavailableError('Payments are not configured. Set CHAPA_SECRET_KEY');
  return env.CHAPA_SECRET_KEY;
}

async function call(method, path, { json, form, timeoutMs = 15_000 } = {}) {
  const headers = { Authorization: `Bearer ${requireKey()}`, Accept: 'application/json' };
  let body;
  if (json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  }
  const url = `${env.CHAPA_BASE_URL.replace(/\/$/, '')}${path}`;
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    logger.error({ err, path }, 'chapa request failed');
    throw new ChapaUnavailableError('Could not reach the payment provider. Try again in a moment');
  }
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 500) }; }
  logger.info({ path: path.replace(/\/[^/]+$/, '/…'), status: res.status, ms: Date.now() - started }, 'chapa call');
  return { httpStatus: res.status, body: parsed };
}

const enc = encodeURIComponent;

export const chapa = {
  /** POST /transaction/initialize → data.checkout_url */
  initialize: (payload) => call('POST', '/transaction/initialize', { json: payload }),
  /** GET /transaction/verify/:tx_ref */
  verify: (txRef) => call('GET', `/transaction/verify/${enc(txRef)}`),
  /** POST /refund/:tx_ref (form fields: reason, amount, reference, meta[...]) → data.ref_id or similar */
  refund: (txRef, { amount, reason, reference }) => call('POST', `/refund/${enc(txRef)}`, { form: { amount, reason, reference } }),
  /** GET /refund/:ref_id/verify → data.status: initiated | processing | refunded | reversed */
  verifyRefund: (refId) => call('GET', `/refund/${enc(refId)}/verify`),
  /** POST /transfers. Chapa processes transfers Mon–Sat, 08:30–16:30. */
  transfer: (payload) => call('POST', '/transfers', { json: payload }),
  /** GET /transfers/verify/:reference */
  verifyTransfer: (reference) => call('GET', `/transfers/verify/${enc(reference)}`),
  /** GET /banks → data: [{ id, name, slug, acct_length, is_mobilemoney, ... }] */
  banks: () => call('GET', '/banks'),
};

/** Turn a Chapa error body into something an admin can act on. */
export function chapaMessage(res) {
  const m = res?.body?.message;
  if (typeof m === 'string') return m.slice(0, 300);
  if (m && typeof m === 'object') return JSON.stringify(m).slice(0, 300);
  return `HTTP ${res?.httpStatus}`;
}
