import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'bun:test';
import {
  TX_REF_PATTERN, buildTxRef, chapaPhone, chapaText, classifyVerification, computeSettlement, isBalanced, ledger,
  receiptNumber, refundableAmount, splitSaleRefund, verifyWebhookSignature,
} from '../../src/modules/payments/payment.rules.js';

const ETB = (n) => BigInt(Math.round(n * 100));

describe('settlement', () => {
  it('the winner pays their (small) bid; the seller gets the agreed price less 10%', () => {
    const s = computeSettlement({ finalPrice: ETB(37.45), buyerPremium: 0n, sellerPrice: ETB(145_000), sellerCommissionBp: 1000 });
    assert.equal(s.cashDue, ETB(37.45));
    assert.equal(s.total, ETB(37.45));
    assert.equal(s.commission, ETB(14_500));
    assert.equal(s.sellerNet, ETB(130_500));
  });
  it('adds a buyer premium to what the winner pays when configured', () => {
    const s = computeSettlement({ finalPrice: ETB(100), buyerPremium: ETB(5), sellerPrice: ETB(1000), sellerCommissionBp: 1000 });
    assert.equal(s.cashDue, ETB(105));
    assert.equal(s.sellerNet, ETB(900));
  });
  it('rounds commission to the santim without losing any', () => {
    const s = computeSettlement({ finalPrice: 1n, buyerPremium: 0n, sellerPrice: 12_345n, sellerCommissionBp: 1000 });
    assert.equal(s.commission + s.sellerNet, 12_345n);
  });
});

describe('ledger', () => {
  const s = computeSettlement({ finalPrice: ETB(37.45), buyerPremium: 0n, sellerPrice: ETB(145_000), sellerCommissionBp: 1000 });
  const groups = {
    bidFeePaid: ledger.bidFeePaid(ETB(10)),
    bidFeeRefunded: ledger.bidFeeRefunded(ETB(10)),
    salePaid: ledger.salePaid(s),
    providerFee: ledger.providerFee(ETB(0.35)),
    payoutPaid: ledger.payoutPaid(s.sellerNet),
    payoutReversed: ledger.payoutReversed(s.sellerNet),
    unappliedReceived: ledger.unappliedReceived(ETB(10)),
    unappliedRefunded: ledger.unappliedRefunded(ETB(10)),
    saleRefunded: ledger.saleRefunded({ fromSeller: ETB(100), fromPlatform: ETB(5) }),
  };
  for (const [name, lines] of Object.entries(groups)) {
    it(`${name} balances`, () => {
      assert.ok(lines.length >= 2);
      assert.ok(isBalanced(lines));
    });
  }
  it('empties escrow after a sale', () => {
    const net = groups.salePaid
      .filter((l) => l.account === 'ESCROW')
      .reduce((t, l) => t + (l.direction === 'DEBIT' ? l.amount : -l.amount), 0n);
    assert.equal(net, 0n);
  });
  it('skips zero-amount moves', () => assert.deepEqual(ledger.bidFeePaid(0n), []));
  it('a sale credits the seller the agreed price less commission, paid from platform revenue', () => {
    const toSeller = groups.salePaid.find((l) => l.account === 'SELLER_PAYABLE');
    assert.equal(toSeller.direction, 'DEBIT');
    assert.equal(toSeller.amount, ETB(130_500));
  });
  it('detects unbalanced groups', () => {
    assert.equal(isBalanced([{ account: 'ESCROW', direction: 'DEBIT', amount: 5n }]), false);
    assert.equal(isBalanced([{ account: 'ESCROW', direction: 'DEBIT', amount: 0n }, { account: 'EXTERNAL', direction: 'CREDIT', amount: 0n }]), false);
  });
  it('splits a sale refund seller first', () => {
    assert.deepEqual(splitSaleRefund(ETB(1000), { sellerNetUnpaid: ETB(900) }), { fromSeller: ETB(900), fromPlatform: ETB(100) });
    assert.deepEqual(splitSaleRefund(ETB(500), { sellerNetUnpaid: ETB(900) }), { fromSeller: ETB(500), fromPlatform: 0n });
    assert.deepEqual(splitSaleRefund(ETB(500), { sellerNetUnpaid: 0n }), { fromSeller: 0n, fromPlatform: ETB(500) });
  });
  it('limits refunds to what is left', () => {
    assert.equal(refundableAmount({ status: 'PAID', amount: ETB(100), refundedAmount: 0n }), ETB(100));
    assert.equal(refundableAmount({ status: 'PARTIALLY_REFUNDED', amount: ETB(100), refundedAmount: ETB(30) }, ETB(20)), ETB(50));
    assert.equal(refundableAmount({ status: 'PENDING', amount: ETB(100), refundedAmount: 0n }), 0n);
    assert.equal(refundableAmount({ status: 'PAID', amount: ETB(100), refundedAmount: ETB(100) }), 0n);
  });
});

describe('Chapa verification', () => {
  const payment = { txRef: 'LB-W-42-abc', amount: ETB(164_000), currency: 'ETB' };
  const ok = (data, httpStatus = 200) => ({ httpStatus, body: { message: 'Payment details', status: 'success', data } });
  const data = { tx_ref: 'LB-W-42-abc', currency: 'ETB', amount: 164000, charge: 4920, status: 'success', mode: 'live', reference: 'APqDvYw1okk2', method: 'telebirr' };
  const live = { expectLive: true };

  it('accepts a matching successful payment', () => {
    const r = classifyVerification(payment, ok(data), live);
    assert.equal(r.state, 'success');
    assert.equal(r.providerRef, 'APqDvYw1okk2');
    assert.equal(r.fee, ETB(4920));
    assert.equal(r.method, 'telebirr');
  });
  it('accepts amounts sent as strings with decimals', () => {
    assert.equal(classifyVerification(payment, ok({ ...data, amount: '164000.00', charge: '4920.00' }), live).state, 'success');
  });
  it('refuses a payment for a different amount', () => {
    assert.equal(classifyVerification(payment, ok({ ...data, amount: 163_999.99 }), live).reason, 'AMOUNT_MISMATCH');
    assert.equal(classifyVerification(payment, ok({ ...data, amount: 1640 }), live).reason, 'AMOUNT_MISMATCH');
  });
  it('refuses another reference, currency or a test payment in production', () => {
    assert.equal(classifyVerification(payment, ok({ ...data, tx_ref: 'LB-W-43-abc' }), live).reason, 'TX_REF_MISMATCH');
    assert.equal(classifyVerification(payment, ok({ ...data, currency: 'USD' }), live).reason, 'CURRENCY_MISMATCH');
    assert.equal(classifyVerification(payment, ok({ ...data, mode: 'test' }), live).reason, 'TEST_MODE_PAYMENT');
    assert.equal(classifyVerification(payment, ok({ ...data, mode: 'test' }), { expectLive: false }).state, 'success');
  });
  it('maps pending, failed and missing payments', () => {
    assert.equal(classifyVerification(payment, ok({ ...data, status: 'pending' }), live).state, 'pending');
    assert.equal(classifyVerification(payment, ok({ ...data, status: 'failed' }), live).state, 'failed');
    assert.equal(classifyVerification(payment, { httpStatus: 404, body: { message: 'Payment not paid yet', status: null, data: null } }, live).state, 'pending');
    assert.equal(classifyVerification(payment, { httpStatus: 404, body: { message: 'Invalid transaction or Transaction not found', data: null } }, live).state, 'not_found');
    assert.equal(classifyVerification(payment, { httpStatus: 502, body: null }, live).state, 'error');
    assert.equal(classifyVerification(payment, ok({ ...data, status: 'weird' }), live).state, 'error');
  });
});

describe('webhook signatures', () => {
  const secret = 'whsec-test-123';
  const body = { event: 'charge.success', tx_ref: 'LB-W-42-abc', status: 'success' };
  const raw = Buffer.from(JSON.stringify(body));
  const sign = (d) => createHmac('sha256', secret).update(d).digest('hex');

  it('accepts a payload signature over the raw body', () => {
    assert.equal(verifyWebhookSignature({ headers: { 'x-chapa-signature': sign(raw) }, rawBody: raw, parsedBody: body, secret }), 'payload');
  });
  it('accepts a payload signature over the re-serialised body', () => {
    const spaced = Buffer.from(JSON.stringify(body, null, 2));
    assert.equal(verifyWebhookSignature({ headers: { 'x-chapa-signature': sign(JSON.stringify(body)) }, rawBody: spaced, parsedBody: body, secret }), 'payload');
  });
  it('accepts the secret-only signature', () => {
    assert.equal(verifyWebhookSignature({ headers: { 'chapa-signature': sign(secret) }, rawBody: raw, parsedBody: body, secret }), 'secret');
  });
  it('rejects wrong, missing or malformed signatures', () => {
    assert.equal(verifyWebhookSignature({ headers: { 'x-chapa-signature': sign('other') }, rawBody: raw, parsedBody: body, secret }), null);
    assert.equal(verifyWebhookSignature({ headers: {}, rawBody: raw, parsedBody: body, secret }), null);
    assert.equal(verifyWebhookSignature({ headers: { 'x-chapa-signature': 'zz' }, rawBody: raw, parsedBody: body, secret }), null);
    assert.equal(verifyWebhookSignature({ headers: { 'x-chapa-signature': sign(raw) }, rawBody: raw, parsedBody: body, secret: undefined }), null);
  });
});

describe('Chapa formatting', () => {
  it('builds references and receipt numbers', () => {
    assert.equal(buildTxRef('BID_FEE', 42n, 'abc'), 'LB-F-42-abc');
    assert.equal(buildTxRef('WINNING_BID', 42n, 'abc'), 'LB-W-42-abc');
    assert.ok(TX_REF_PATTERN.test('LB-F-42-01jabc'));
    assert.ok(!TX_REF_PATTERN.test('LB-D-42-01jabc'));
    assert.equal(receiptNumber(123n, new Date('2026-11-09T10:00:00Z')), 'LB-R-20261109-000123');
  });
  it('formats phones and text the way Chapa accepts', () => {
    assert.equal(chapaPhone('+251912345678'), '0912345678');
    assert.equal(chapaPhone('+251712345678'), '0712345678');
    assert.equal(chapaPhone(undefined), undefined);
    assert.equal(chapaText('Payment: "iPhone 15" & co!', 50), 'Payment iPhone 15 co');
    assert.equal(chapaText('LOW BID auction 12345', 16), 'LOW BID auction');
  });
});
