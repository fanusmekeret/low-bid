import { prisma } from '../../config/prisma.js';
import { conflict, forbidden, unauthorized } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { maskPhone } from '../../utils/phone.js';
import { recordAudit } from '../audit/audit.service.js';
import { ROLES } from '../rbac/permissions.js';
import { getUserRoleCodes, grantRole, permissionsForRoles } from '../rbac/rbac.service.js';
import { presentUser } from '../users/users.presenter.js';
import { OTP_PURPOSE, sendOtp, verifyOtp } from './otp.service.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password.js';
import { issueRefreshToken, revokeAllForUser, revokeByRawToken, revokeFamily, rotateRefreshToken, signAccessToken } from './tokens.js';

/** @typedef {{ ip?: string, userAgent?: string }} ClientMeta */

export async function loadUserProfile(userId) {
  const user = await prisma.user.findUnique({ where: { id: BigInt(userId) } });
  if (!user) throw unauthorized('AUTH_USER_NOT_FOUND', 'Account not found');
  const roles = await getUserRoleCodes(user.id);
  const permissions = await permissionsForRoles(roles);
  return { user, roles, permissions };
}

function assertActive(user) {
  if (user.status === 'SUSPENDED') throw forbidden('ACCOUNT_SUSPENDED', 'Your account is suspended. Contact support');
  if (user.status === 'BANNED') throw forbidden('ACCOUNT_BANNED', 'Your account has been closed');
}

async function buildSession(userId, meta, refreshToken) {
  const { user, roles, permissions } = await loadUserProfile(userId);
  const access = signAccessToken(user, roles);
  const refresh = refreshToken ?? (await issueRefreshToken(user.id, meta)).raw;
  return {
    user: presentUser(user, roles, permissions),
    tokens: { accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken: refresh },
  };
}

/** @param {import('zod').infer<typeof import('./auth.schemas.js').registerSchema>} input */
export async function register(input, meta) {
  const existing = await prisma.user.findUnique({ where: { phone: input.phone }, select: { id: true } });
  if (existing) throw conflict('PHONE_TAKEN', 'An account with this phone number already exists');
  if (input.email) {
    const emailTaken = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (emailTaken) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        phone: input.phone,
        email: input.email ?? null,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        locale: input.locale,
      },
    });
    await grantRole(created.id, ROLES.BUYER, null, tx);
    await recordAudit({ actorId: created.id, action: 'user.register', entity: 'user', entityId: created.id, req: meta.req }, tx);
    return created;
  });

  let otp = { sent: false, to: maskPhone(user.phone) };
  try {
    const sent = await sendOtp({ phone: user.phone, purpose: OTP_PURPOSE.VERIFY_PHONE, userId: user.id, locale: user.locale });
    otp = { ...otp, sent: true, ...sent };
  } catch (err) {
    // Account exists either way; the app offers "resend code".
    logger.warn({ err, userId: user.id.toString() }, 'verification OTP not sent at registration');
  }

  return { ...(await buildSession(user.id, meta)), otp };
}

export async function login({ phone, password }, meta) {
  const user = await prisma.user.findUnique({ where: { phone } });
  const ok = user ? await verifyPassword(user.passwordHash, password) : await burnPasswordCheck(password);
  if (!user || !ok) throw unauthorized('AUTH_INVALID_CREDENTIALS', 'Incorrect phone number or password');
  assertActive(user);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return buildSession(user.id, meta);
}

export async function sendPhoneVerification(userId) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: BigInt(userId) } });
  if (user.phoneVerifiedAt) throw conflict('PHONE_ALREADY_VERIFIED', 'Your phone number is already verified');
  const sent = await sendOtp({ phone: user.phone, purpose: OTP_PURPOSE.VERIFY_PHONE, userId: user.id, locale: user.locale });
  return { to: maskPhone(user.phone), ...sent };
}

/** Verifying the phone grants the bidder role. Returns a fresh access token carrying it. */
export async function verifyPhone(userId, code, meta) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: BigInt(userId) } });
  if (user.phoneVerifiedAt) throw conflict('PHONE_ALREADY_VERIFIED', 'Your phone number is already verified');
  await verifyOtp({ phone: user.phone, purpose: OTP_PURPOSE.VERIFY_PHONE, code });

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } });
    await grantRole(user.id, ROLES.BIDDER, null, tx);
    await recordAudit({ actorId: user.id, action: 'user.phone_verified', entity: 'user', entityId: user.id, req: meta.req }, tx);
  });

  const { user: fresh, roles, permissions } = await loadUserProfile(user.id);
  const access = signAccessToken(fresh, roles);
  return { user: presentUser(fresh, roles, permissions), tokens: { accessToken: access.token, accessTokenExpiresAt: access.expiresAt } };
}

export async function refresh(rawRefreshToken, meta) {
  const { userId, refreshToken } = await rotateRefreshToken(rawRefreshToken, meta);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized('AUTH_USER_NOT_FOUND', 'Account not found');
  if (user.status !== 'ACTIVE') {
    await revokeAllForUser(user.id);
    assertActive(user);
  }
  return buildSession(user.id, meta, refreshToken);
}

export async function logout(rawRefreshToken) {
  await revokeByRawToken(rawRefreshToken);
}

export async function logoutEverywhere(userId) {
  await revokeAllForUser(userId);
}

/** Always resolves the same way so the endpoint does not reveal which numbers have accounts. */
export async function forgotPassword(phone) {
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user || user.status !== 'ACTIVE') return;
  try {
    await sendOtp({ phone, purpose: OTP_PURPOSE.RESET_PASSWORD, userId: user.id, locale: user.locale });
  } catch (err) {
    logger.warn({ err: err.code ?? err.message }, 'password reset OTP not sent');
  }
}

export async function resetPassword({ phone, code, newPassword }, meta) {
  await verifyOtp({ phone, purpose: OTP_PURPOSE.RESET_PASSWORD, code });
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) throw unauthorized('AUTH_USER_NOT_FOUND', 'Account not found');
  assertActive(user);

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    // The OTP proves the phone, so an unverified account becomes verified here too.
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, phoneVerifiedAt: user.phoneVerifiedAt ?? new Date() } });
    if (!user.phoneVerifiedAt) await grantRole(user.id, ROLES.BIDDER, null, tx);
    await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordAudit({ actorId: user.id, action: 'user.password_reset', entity: 'user', entityId: user.id, req: meta.req }, tx);
  });
}

export async function changePassword(userId, { currentPassword, newPassword }, meta) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: BigInt(userId) } });
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw unauthorized('AUTH_INVALID_CREDENTIALS', 'Current password is incorrect');
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await recordAudit({ actorId: user.id, action: 'user.password_change', entity: 'user', entityId: user.id, req: meta.req }, tx);
  });
  // Sign out other devices; the caller logs in again with a new session.
  await revokeAllForUser(user.id);
  return buildSession(user.id, meta);
}

export { revokeFamily };
