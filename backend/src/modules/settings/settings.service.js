import { prisma } from '../../config/prisma.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { SETTING_DEFINITIONS } from './settings.definitions.js';

const TTL_MS = 30_000;
const cache = new Map(); // key → { value, at }

/**
 * Current value of a setting: the stored row if valid, otherwise the default.
 * Cached for 30 s; admin edits through updateSetting take effect immediately.
 */
export async function getSetting(key) {
  const def = SETTING_DEFINITIONS[key];
  if (!def) throw new Error(`Unknown setting ${key}`);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const row = await prisma.systemSetting.findUnique({ where: { key } });
  const parsed = row ? def.schema.safeParse(row.value) : null;
  const value = parsed?.success ? parsed.data : def.default;
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function listSettings() {
  const rows = await prisma.systemSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return Object.entries(SETTING_DEFINITIONS).map(([key, def]) => {
    const row = byKey.get(key);
    const parsed = row ? def.schema.safeParse(row.value) : null;
    return {
      key,
      description: def.description,
      value: parsed?.success ? parsed.data : def.default,
      isDefault: !parsed?.success,
      updatedAt: row?.updatedAt ?? null,
      updatedById: row?.updatedById?.toString() ?? null,
    };
  });
}

export async function updateSetting(key, value, { actorId, req }) {
  const def = SETTING_DEFINITIONS[key];
  if (!def) throw notFound('SETTING_NOT_FOUND', `Unknown setting ${key}`);
  const parsed = def.schema.safeParse(value);
  if (!parsed.success) {
    throw badRequest('VALIDATION_FAILED', 'Some fields are invalid', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  const before = await getSetting(key);
  await prisma.$transaction(async (tx) => {
    await tx.systemSetting.upsert({
      where: { key },
      update: { value: parsed.data, updatedById: BigInt(actorId) },
      create: { key, value: parsed.data, description: def.description, updatedById: BigInt(actorId) },
    });
    await recordAudit({ actorId, action: 'settings.update', entity: 'system_setting', entityId: key, before, after: parsed.data, req }, tx);
  });
  cache.delete(key);
  return parsed.data;
}

export function clearSettingsCache() {
  cache.clear();
}
