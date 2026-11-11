import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { badRequest, forbidden, notFound } from '../../utils/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { revokeAllForUser } from '../auth/tokens.js';
import { PERMISSIONS, ROLES } from '../rbac/permissions.js';
import { getUserRoleCodes, grantRole, listRolesWithPermissions, permissionsForRoles, revokeRole } from '../rbac/rbac.service.js';
import { presentUser } from '../users/users.presenter.js';

const P = PERMISSIONS;
const idParam = z.object({ id: z.coerce.bigint().positive() });

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']).optional(),
  role: z.string().max(50).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const statusBody = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']),
  reason: z.string().trim().min(3).max(500),
});

const ASSIGNABLE = [ROLES.BUYER, ROLES.BIDDER, ROLES.AUCTION_ADMIN, ROLES.SUPER_ADMIN];
const roleBody = z.object({ role: z.enum(ASSIGNABLE) });

export const adminUsersRouter = Router();
adminUsersRouter.use(authenticate, requirePermission(P.ADMIN_ACCESS));

adminUsersRouter.get('/roles', requirePermission(P.USER_VIEW), async (_req, res) => {
  res.json({ data: await listRolesWithPermissions() });
});

adminUsersRouter.get('/users', requirePermission(P.USER_VIEW), validate({ query: listQuery }), async (req, res) => {
  const { q, status, role, page, pageSize } = req.valid.query;
  const where = {
    ...(status && { status }),
    ...(role && { roles: { some: { role: { code: role } } } }),
    ...(q && {
      OR: [
        { phone: { contains: q.replace(/\s/g, '') } },
        { email: { contains: q } },
        { firstName: { contains: q } },
        { lastName: { contains: q } },
      ],
    }),
  };
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { roles: { include: { role: true } } },
    }),
  ]);
  res.json({
    data: users.map((u) => ({ ...presentUser(u, u.roles.map((r) => r.role.code)), permissions: undefined, lastLoginAt: u.lastLoginAt, paymentStrikes: u.paymentStrikes })),
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
});

adminUsersRouter.get('/users/:id', requirePermission(P.USER_VIEW), validate({ params: idParam }), async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.valid.params.id },
    include: { _count: { select: { bids: true, payments: true, devices: true } } },
  });
  if (!user) throw notFound('USER_NOT_FOUND', 'User not found');
  const roles = await getUserRoleCodes(user.id);
  res.json({
    data: {
      ...presentUser(user, roles, await permissionsForRoles(roles)),
      lastLoginAt: user.lastLoginAt,
      paymentStrikes: user.paymentStrikes,
      counts: user._count,
    },
  });
});

adminUsersRouter.patch('/users/:id/status', requirePermission(P.USER_MANAGE), validate({ params: idParam, body: statusBody }), async (req, res) => {
  const id = req.valid.params.id;
  if (id === req.auth.userId) throw badRequest('CANNOT_CHANGE_OWN_STATUS', 'You cannot change your own account status');
  const before = await prisma.user.findUnique({ where: { id }, select: { status: true } });
  if (!before) throw notFound('USER_NOT_FOUND', 'User not found');

  const targetRoles = await getUserRoleCodes(id);
  if (targetRoles.includes(ROLES.SUPER_ADMIN) && !req.auth.roles.includes(ROLES.SUPER_ADMIN)) {
    throw forbidden('PERMISSION_DENIED', 'Only a super administrator can change another super administrator');
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { status: req.valid.body.status } });
    await recordAudit({
      actorId: req.auth.userId, action: 'user.status_change', entity: 'user', entityId: id,
      before, after: { status: req.valid.body.status, reason: req.valid.body.reason }, req,
    }, tx);
  });
  // Suspended or banned users lose their sessions immediately; access tokens expire within 15 minutes.
  if (req.valid.body.status !== 'ACTIVE') await revokeAllForUser(id);
  res.json({ data: { id: id.toString(), status: req.valid.body.status } });
});

adminUsersRouter.post('/users/:id/roles', requirePermission(P.ROLE_ASSIGN), validate({ params: idParam, body: roleBody }), async (req, res) => {
  const id = req.valid.params.id;
  const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw notFound('USER_NOT_FOUND', 'User not found');
  await prisma.$transaction(async (tx) => {
    await grantRole(id, req.valid.body.role, req.auth.userId, tx);
    await recordAudit({ actorId: req.auth.userId, action: 'user.role_grant', entity: 'user', entityId: id, after: { role: req.valid.body.role }, req }, tx);
  });
  res.json({ data: { id: id.toString(), roles: await getUserRoleCodes(id) } });
});

adminUsersRouter.delete('/users/:id/roles/:role', requirePermission(P.ROLE_ASSIGN), validate({ params: idParam.extend({ role: z.enum(ASSIGNABLE) }) }), async (req, res) => {
  const { id, role } = req.valid.params;
  if (id === req.auth.userId && role === ROLES.SUPER_ADMIN) {
    throw badRequest('CANNOT_REMOVE_OWN_SUPER_ADMIN', 'You cannot remove your own super administrator role');
  }
  if (role === ROLES.BUYER) throw badRequest('ROLE_REQUIRED', 'Every account keeps the buyer role');
  if (role === ROLES.SUPER_ADMIN) {
    const remaining = await prisma.userRole.count({ where: { role: { code: ROLES.SUPER_ADMIN }, NOT: { userId: id } } });
    if (remaining === 0) throw badRequest('LAST_SUPER_ADMIN', 'At least one super administrator must remain');
  }
  await prisma.$transaction(async (tx) => {
    await revokeRole(id, role, tx);
    await recordAudit({ actorId: req.auth.userId, action: 'user.role_revoke', entity: 'user', entityId: id, before: { role }, req }, tx);
  });
  res.json({ data: { id: id.toString(), roles: await getUserRoleCodes(id) } });
});
