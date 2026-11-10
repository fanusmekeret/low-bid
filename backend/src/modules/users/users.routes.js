import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { conflict } from '../../utils/errors.js';
import { passwordField } from '../auth/auth.schemas.js';
import { changePassword, loadUserProfile } from '../auth/auth.service.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { presentUser } from './users.presenter.js';

const updateMeSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().toLowerCase().email().max(191).nullable(),
    locale: z.enum(['en', 'am']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordField });

const deviceSchema = z.object({
  fcmToken: z.string().min(20).max(255),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']),
  appVersion: z.string().max(20).optional(),
});

export const meRouter = Router();
meRouter.use(authenticate);

meRouter.get('/', async (req, res) => {
  const { user, roles, permissions } = await loadUserProfile(req.auth.userId);
  res.json({ data: presentUser(user, roles, permissions) });
});

meRouter.patch('/', requirePermission(PERMISSIONS.PROFILE_MANAGE), validate({ body: updateMeSchema }), async (req, res) => {
  const body = req.valid.body;
  if (body.email) {
    const taken = await prisma.user.findFirst({ where: { email: body.email, NOT: { id: req.auth.userId } }, select: { id: true } });
    if (taken) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
  }
  await prisma.user.update({ where: { id: req.auth.userId }, data: body });
  const { user, roles, permissions } = await loadUserProfile(req.auth.userId);
  res.json({ data: presentUser(user, roles, permissions) });
});

meRouter.post('/password', validate({ body: changePasswordSchema }), async (req, res) => {
  const meta = { ip: req.ip, userAgent: req.get('user-agent'), req };
  res.json({ data: await changePassword(req.auth.userId, req.valid.body, meta) });
});

// A device token belongs to whoever is signed in on it now.
meRouter.post('/devices', validate({ body: deviceSchema }), async (req, res) => {
  const { fcmToken, platform, appVersion } = req.valid.body;
  await prisma.userDevice.upsert({
    where: { fcmToken },
    update: { userId: req.auth.userId, platform, appVersion, lastSeenAt: new Date() },
    create: { userId: req.auth.userId, fcmToken, platform, appVersion },
  });
  res.status(204).end();
});

meRouter.delete('/devices/:fcmToken', async (req, res) => {
  await prisma.userDevice.deleteMany({ where: { fcmToken: req.params.fcmToken, userId: req.auth.userId } });
  res.status(204).end();
});
