import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { presentNotification } from './notifications.service.js';

const listQuery = z.object({
  unread: z.enum(['true', 'false']).optional(),
  cursor: z.coerce.bigint().positive().optional(), // id of the last item from the previous page
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const notificationsRouter = Router();
notificationsRouter.use(authenticate, requirePermission(PERMISSIONS.NOTIFICATION_READ));

notificationsRouter.get('/', validate({ query: listQuery }), async (req, res) => {
  const { unread, cursor, limit } = req.valid.query;
  const where = { userId: req.auth.userId, ...(unread === 'true' && { readAt: null }), ...(cursor && { id: { lt: cursor } }) };
  const [items, unreadCount, user] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { id: 'desc' }, take: limit + 1 }),
    prisma.notification.count({ where: { userId: req.auth.userId, readAt: null } }),
    prisma.user.findUnique({ where: { id: req.auth.userId }, select: { locale: true } }),
  ]);
  const page = items.slice(0, limit);
  res.json({
    data: page.map((n) => presentNotification(n, user?.locale)),
    meta: { unreadCount, nextCursor: items.length > limit ? page.at(-1).id.toString() : null },
  });
});

notificationsRouter.post('/:id/read', validate({ params: z.object({ id: z.coerce.bigint().positive() }) }), async (req, res) => {
  await prisma.notification.updateMany({ where: { id: req.valid.params.id, userId: req.auth.userId, readAt: null }, data: { readAt: new Date() } });
  res.status(204).end();
});

notificationsRouter.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.auth.userId, readAt: null }, data: { readAt: new Date() } });
  res.status(204).end();
});
