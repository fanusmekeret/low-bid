import { moneyDto } from '../../utils/money.js';

export function presentPayment(p, { admin = false } = {}) {
  return {
    id: p.id.toString(),
    txRef: p.txRef,
    purpose: p.purpose,
    status: p.status,
    amount: moneyDto(p.amount),
    refundedAmount: moneyDto(p.refundedAmount ?? 0n),
    currency: p.currency,
    checkoutUrl: ['INITIATED', 'PENDING'].includes(p.status) ? p.checkoutUrl : null,
    paymentMethod: p.paymentMethod,
    receiptNo: p.receiptNo,
    expiresAt: p.expiresAt,
    verifiedAt: p.verifiedAt,
    createdAt: p.createdAt,
    auctionId: p.auctionId?.toString() ?? null,
    bidId: p.bid?.id?.toString() ?? null,
    ...(admin && {
      userId: p.userId.toString(),
      providerRef: p.providerRef,
      providerFee: moneyDto(p.providerFee),
      failureReason: p.failureReason,
      lastCheckedAt: p.lastCheckedAt,
      resultId: p.resultId?.toString() ?? null,
    }),
  };
}

export function presentRefund(r) {
  return {
    id: r.id.toString(),
    paymentId: r.paymentId.toString(),
    kind: r.kind,
    reference: r.reference,
    amount: moneyDto(r.amount),
    reason: r.reason,
    status: r.status,
    providerRef: r.providerRef,
    providerStatus: r.providerStatus,
    failureReason: r.failureReason,
    attempts: r.attempts,
    requestedById: r.requestedById?.toString() ?? null,
    reviewedAt: r.reviewedAt,
    processedAt: r.processedAt,
    createdAt: r.createdAt,
  };
}

export function presentPayout(p, { full = false } = {}) {
  return {
    id: p.id.toString(),
    reference: p.reference,
    status: p.status,
    method: p.method,
    grossAmount: moneyDto(p.grossAmount),
    commission: moneyDto(p.commission),
    netAmount: moneyDto(p.netAmount),
    releaseAfter: p.releaseAfter,
    paidAt: p.paidAt,
    providerRef: p.providerRef,
    failureReason: p.failureReason,
    resultId: p.resultId?.toString() ?? null,
    account: full
      ? { bankCode: p.bankCode, accountName: p.accountName, accountNo: p.accountNo }
      : { bankCode: p.bankCode, accountName: p.accountName, accountNo: p.accountNo ? `•••• ${p.accountNo.slice(-4)}` : null },
    createdAt: p.createdAt,
  };
}
