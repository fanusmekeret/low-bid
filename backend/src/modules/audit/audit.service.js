import { prisma } from '../../config/prisma.js';
import { logger } from '../../utils/logger.js';

// BigInt and Date values are not JSON; make snapshots storable.
function toJsonSafe(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

/**
 * Records who did what. Pass `db` (a transaction client) to make the log part of the same transaction.
 * @param {{ actorId?: bigint|null, action: string, entity: string, entityId?: string|bigint|number|null,
 *           before?: unknown, after?: unknown, req?: import('express').Request }} entry
 */
export async function recordAudit(entry, db = prisma) {
  const { actorId = null, action, entity, entityId = null, before, after, req } = entry;
  try {
    await db.auditLog.create({
      data: {
        actorId: actorId === null ? null : BigInt(actorId),
        action,
        entity,
        entityId: entityId === null ? null : String(entityId),
        before: toJsonSafe(before),
        after: toJsonSafe(after),
        ip: req?.ip ?? null,
        userAgent: req?.get?.('user-agent')?.slice(0, 255) ?? null,
        requestId: req?.id ?? null,
      },
    });
  } catch (err) {
    // Inside a transaction the caller must see the failure; outside, never break the request.
    if (db !== prisma) throw err;
    logger.error({ err, action, entity }, 'audit log write failed');
  }
}
