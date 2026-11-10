import { prisma } from '../../config/prisma.js';

const CACHE_TTL_MS = 60_000;
let cache = { loadedAt: 0, byRole: new Map() };
let loading = null;

async function reload() {
  const rows = await prisma.rolePermission.findMany({
    select: { role: { select: { code: true } }, permission: { select: { code: true } } },
  });
  const byRole = new Map();
  for (const row of rows) {
    if (!byRole.has(row.role.code)) byRole.set(row.role.code, new Set());
    byRole.get(row.role.code).add(row.permission.code);
  }
  cache = { loadedAt: Date.now(), byRole };
}

async function ensureFresh() {
  if (Date.now() - cache.loadedAt < CACHE_TTL_MS) return;
  if (!loading) loading = reload().finally(() => { loading = null; });
  await loading;
}

/** Union of permissions for the given role codes (cached for 60 s). */
export async function permissionsForRoles(roleCodes) {
  await ensureFresh();
  const out = new Set();
  for (const code of roleCodes) for (const p of cache.byRole.get(code) ?? []) out.add(p);
  return out;
}

/** Force a reload on the next lookup, e.g. after an admin edits role permissions. */
export function invalidatePermissionCache() {
  cache = { loadedAt: 0, byRole: new Map() };
}

export async function getUserRoleCodes(userId, db = prisma) {
  const rows = await db.userRole.findMany({ where: { userId: BigInt(userId) }, select: { role: { select: { code: true } } } });
  return rows.map((r) => r.role.code);
}

/** Idempotent: adds the role if missing. */
export async function grantRole(userId, roleCode, assignedBy = null, db = prisma) {
  const role = await db.role.findUnique({ where: { code: roleCode } });
  if (!role) throw new Error(`Unknown role ${roleCode}`);
  await db.userRole.upsert({
    where: { userId_roleId: { userId: BigInt(userId), roleId: role.id } },
    update: {},
    create: { userId: BigInt(userId), roleId: role.id, assignedBy: assignedBy === null ? null : BigInt(assignedBy) },
  });
}

export async function revokeRole(userId, roleCode, db = prisma) {
  const role = await db.role.findUnique({ where: { code: roleCode } });
  if (!role) return;
  await db.userRole.deleteMany({ where: { userId: BigInt(userId), roleId: role.id } });
}

export async function listRolesWithPermissions() {
  const roles = await prisma.role.findMany({
    orderBy: { id: 'asc' },
    include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
  });
  return roles.map((r) => ({
    code: r.code,
    name: r.name,
    description: r.description,
    userCount: r._count.users,
    permissions: r.permissions.map((rp) => rp.permission.code).sort(),
  }));
}
