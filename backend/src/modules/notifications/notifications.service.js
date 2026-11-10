import { prisma } from '../../config/prisma.js';
import { TEMPLATES } from './notifications.templates.js';

const toJsonSafe = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))));

/**
 * Stores an in-app notification. Pass a transaction client as `db` to make it part of the
 * same change (e.g. approving a seller). Push delivery through FCM is added in Phase 8 and
 * reads these rows, so callers do not change.
 * @param {bigint|string} userId
 * @param {keyof typeof TEMPLATES} type
 * @param {object} params template parameters
 * @param {object} [data] deep-link data, e.g. { productId }
 */
export async function notify(userId, type, params = {}, data = undefined, db = prisma) {
  const template = TEMPLATES[type];
  if (!template) throw new Error(`No notification template for ${type}`);
  return db.notification.create({
    data: { userId: BigInt(userId), type, ...template(params), data: toJsonSafe(data) },
  });
}

/** Same notification to many users in one insert (e.g. every losing bidder). */
export async function notifyMany(userIds, type, params = {}, data = undefined, db = prisma) {
  const unique = [...new Set(userIds.map((id) => BigInt(id)))];
  if (unique.length === 0) return 0;
  const template = TEMPLATES[type];
  if (!template) throw new Error(`No notification template for ${type}`);
  const text = template(params);
  const payload = toJsonSafe(data);
  const { count } = await db.notification.createMany({ data: unique.map((userId) => ({ userId, type, ...text, data: payload })) });
  return count;
}

export function presentNotification(n, locale = 'en') {
  const am = locale === 'am';
  return {
    id: n.id.toString(),
    type: n.type,
    title: am ? n.titleAm : n.titleEn,
    body: am ? n.bodyAm : n.bodyEn,
    data: n.data,
    read: Boolean(n.readAt),
    createdAt: n.createdAt,
  };
}
