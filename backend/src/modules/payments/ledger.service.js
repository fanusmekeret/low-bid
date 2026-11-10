import { ulid } from 'ulid';
import { prisma } from '../../config/prisma.js';
import { isBalanced } from './payment.rules.js';

/**
 * Writes one balanced group of ledger lines inside the caller's transaction.
 * Throws (rolling the whole change back) if the lines do not balance.
 */
export async function writeLedger(tx, lines, refs = {}) {
  if (lines.length === 0) return null;
  if (!isBalanced(lines)) throw new Error(`Unbalanced ledger group: ${JSON.stringify(lines, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
  const groupId = ulid();
  await tx.transaction.createMany({
    data: lines.map((l) => ({
      groupId,
      account: l.account,
      direction: l.direction,
      amount: l.amount,
      memo: l.memo?.slice(0, 255),
      paymentId: refs.paymentId ?? null,
      refundId: refs.refundId ?? null,
      payoutId: refs.payoutId ?? null,
    })),
  });
  return groupId;
}

/**
 * Balance per account (debits minus credits). Across all accounts the total is always zero;
 * EXTERNAL is negative by the net amount the platform holds.
 */
export async function ledgerBalances() {
  const rows = await prisma.transaction.groupBy({ by: ['account', 'direction'], _sum: { amount: true } });
  const out = {};
  for (const r of rows) {
    const v = r._sum.amount ?? 0n;
    out[r.account] = (out[r.account] ?? 0n) + (r.direction === 'DEBIT' ? v : -v);
  }
  const total = Object.values(out).reduce((t, v) => t + v, 0n);
  return { balances: out, balanced: total === 0n };
}
