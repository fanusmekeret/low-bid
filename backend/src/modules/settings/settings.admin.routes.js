import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { SETTING_KEYS } from './settings.definitions.js';
import { listSettings, updateSetting } from './settings.service.js';

export const adminSettingsRouter = Router();
adminSettingsRouter.use(authenticate, requirePermission(PERMISSIONS.ADMIN_ACCESS, PERMISSIONS.SETTINGS_MANAGE));

adminSettingsRouter.get('/', async (_req, res) => {
  res.json({ data: await listSettings() });
});

adminSettingsRouter.put(
  '/:key',
  validate({ params: z.object({ key: z.enum(SETTING_KEYS) }), body: z.object({ value: z.record(z.unknown()) }) }),
  async (req, res) => {
    const value = await updateSetting(req.valid.params.key, req.valid.body.value, { actorId: req.auth.userId, req });
    res.json({ data: { key: req.valid.params.key, value } });
  },
);
