import { createHmac } from 'node:crypto';
import http from 'node:http';

// A stand-in for api.chapa.co, used only by the integration tests. It follows the documented
// request and response shapes (https://developer.chapa.co) and enforces the input rules we
// must respect, so the tests also prove our requests are valid. Production code never uses it.

export async function startFakeChapa({ secretKey = 'CHASECK_TEST-fake', webhookSecret = 'whsec-fake' } = {}) {
  const tx = new Map(); // tx_ref → { amount, status, ... }
  const refunds = new Map(); // ref_id → { reference, tx_ref, amount, status }
  const transfers = new Map(); // reference → { status }
  const calls = [];

  const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, 'http://fake');
    const body = !raw ? {} : req.headers['content-type']?.includes('json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
    calls.push({ method: req.method, path: url.pathname, body });
    if (req.headers.authorization !== `Bearer ${secretKey}`) return send(res, 401, { message: 'Invalid API Key or User doesn’t exist', status: 'failed', data: null });

    // POST /v1/transaction/initialize
    if (req.method === 'POST' && url.pathname === '/v1/transaction/initialize') {
      const errs = [];
      if (!body.amount || !/^\d+(\.\d{1,2})?$/.test(body.amount)) errs.push('amount');
      if (body.currency !== 'ETB') errs.push('currency');
      if (!body.tx_ref) errs.push('tx_ref');
      if (body.phone_number && !/^0[79]\d{8}$/.test(body.phone_number)) errs.push('phone_number');
      if (body.customization?.title && body.customization.title.length > 16) errs.push('customization.title');
      if (body.customization?.description && !/^[A-Za-z0-9 ._-]*$/.test(body.customization.description)) errs.push('customization.description');
      if (errs.length) return send(res, 400, { message: { errors: errs }, status: 'failed', data: null });
      if (tx.has(body.tx_ref)) return send(res, 400, { message: 'Transaction reference has been used before', status: 'failed', data: null });
      tx.set(body.tx_ref, { ...body, status: 'unpaid', reference: `AP${Math.random().toString(36).slice(2, 12)}` });
      return send(res, 200, { message: 'Hosted Link', status: 'success', data: { checkout_url: `https://checkout.chapa.test/pay/${body.tx_ref}` } });
    }

    // GET /v1/transaction/verify/:tx_ref
    let m = url.pathname.match(/^\/v1\/transaction\/verify\/(.+)$/);
    if (req.method === 'GET' && m) {
      const t = tx.get(decodeURIComponent(m[1]));
      if (!t) return send(res, 404, { message: 'Invalid transaction or Transaction not found', status: 'failed', data: null });
      if (t.status === 'unpaid') return send(res, 404, { message: 'Payment not paid yet', status: null, data: null });
      return send(res, 200, {
        message: 'Payment details',
        status: 'success',
        data: {
          first_name: t.first_name, last_name: t.last_name, email: t.email ?? null, currency: t.paidCurrency ?? 'ETB',
          amount: t.paidAmount ?? Number(t.amount), charge: Number((Number(t.amount) * 0.03).toFixed(2)), mode: 'test', method: 'telebirr',
          type: 'API', status: t.status, reference: t.reference, tx_ref: t.tx_ref, customization: t.customization, meta: t.meta ?? null,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        },
      });
    }

    // POST /v1/refund/:tx_ref
    m = url.pathname.match(/^\/v1\/refund\/([^/]+)$/);
    if (req.method === 'POST' && m) {
      const t = tx.get(decodeURIComponent(m[1]));
      if (!t || t.status !== 'success') return send(res, 400, { message: 'Transaction not refundable', status: 'failed', data: null });
      if ([...refunds.values()].some((r) => r.reference === body.reference)) return send(res, 400, { message: 'Duplicate reference', status: 'failed', data: null });
      const refId = `MERC-REF-${refunds.size + 1}`;
      refunds.set(refId, { reference: body.reference, tx_ref: t.tx_ref, amount: body.amount, status: 'initiated' });
      return send(res, 200, { message: 'Refund initiated', status: 'success', data: { ref_id: refId, status: 'initiated' } });
    }

    // GET /v1/refund/:ref_id/verify
    m = url.pathname.match(/^\/v1\/refund\/([^/]+)\/verify$/);
    if (req.method === 'GET' && m) {
      const r = refunds.get(decodeURIComponent(m[1]));
      if (!r) return send(res, 404, { message: 'Refund not found', status: 'failed', data: null });
      return send(res, 200, { message: 'Refund verified successfully', status: 'success', data: { amount: Number(r.amount), currency: 'ETB', ref_id: m[1], payment_reference: r.tx_ref, merchant_reference: r.reference, status: r.status } });
    }

    // POST /v1/transfers and GET /v1/transfers/verify/:reference
    if (req.method === 'POST' && url.pathname === '/v1/transfers') {
      for (const f of ['account_name', 'account_number', 'amount', 'currency', 'reference', 'bank_code']) {
        if (!body[f]) return send(res, 400, { message: `validation.required ${f}`, status: 'failed', data: null });
      }
      if (transfers.has(body.reference)) return send(res, 400, { message: 'The reference number has been used before', status: 'failed', data: null });
      transfers.set(body.reference, { ...body, status: 'success' });
      return send(res, 200, { message: 'Transfer Queued Successfully in Test Mode', status: 'success', data: body.reference });
    }
    m = url.pathname.match(/^\/v1\/transfers\/verify\/(.+)$/);
    if (req.method === 'GET' && m) {
      const t = transfers.get(decodeURIComponent(m[1]));
      if (!t) return send(res, 404, { message: 'Transfer not found', status: 'failed', data: null });
      return send(res, 200, { message: 'Transfer details', status: 'success', data: { ...t, chapa_reference: `CH-${m[1].slice(-6)}` } });
    }

    if (req.method === 'GET' && url.pathname === '/v1/banks') {
      return send(res, 200, { message: 'Banks retrieved', data: [
        { id: 946, slug: 'cbe', name: 'Commercial Bank of Ethiopia (CBE)', acct_length: 13, is_mobilemoney: null },
        { id: 855, slug: 'telebirr', name: 'telebirr', acct_length: 10, is_mobilemoney: 1 },
      ] });
    }
    return send(res, 404, { message: 'Not found', status: 'failed', data: null });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

  return {
    baseUrl,
    secretKey,
    webhookSecret,
    calls,
    tx,
    /** The buyer completes payment on Chapa's page. Optionally pay a different amount or currency. */
    pay(txRef, { amount, currency } = {}) {
      const t = tx.get(txRef);
      if (!t) throw new Error(`fake chapa: unknown ${txRef}`);
      Object.assign(t, { status: 'success', paidAmount: amount, paidCurrency: currency });
    },
    fail(txRef) { tx.get(txRef).status = 'failed'; },
    completeRefunds() { for (const r of refunds.values()) if (r.status === 'initiated') r.status = 'refunded'; },
    refunds,
    transfers,
    /** Body and headers Chapa would POST to our webhook, signed as documented. */
    webhook(txRef, { event = 'charge.success', sign = true } = {}) {
      const t = tx.get(txRef);
      const body = { event, tx_ref: txRef, status: t?.status ?? 'success', amount: t?.amount, currency: 'ETB', reference: t?.reference, mode: 'test' };
      const raw = JSON.stringify(body);
      const headers = { 'content-type': 'application/json' };
      if (sign) headers['x-chapa-signature'] = createHmac('sha256', webhookSecret).update(raw).digest('hex');
      return { raw, headers };
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
