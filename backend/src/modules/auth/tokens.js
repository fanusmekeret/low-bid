import jwt from 'jsonwebtoken';
import { ulid } from 'ulid';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { randomToken, sha256Hex } from '../../utils/crypto.js';
import { unauthorized } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

const ISSUER = 'lowbid';
const AUDIENCE = 'lowbid-api';

/**
 * @param {{ id: bigint, phoneVerifiedAt: Date | null }} user
 * @param {string[]} roles
 */
export function signAccessToken(user, roles) {
  const token = jwt.sign({ roles, pv: Boolean(user.phoneVerifiedAt) }, env.JWT_ACCESS_SECRET, {
    subject: String(user.id),
    expiresIn: env.JWT_ACCESS_TTL,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: 'HS256',
  });
  const { exp } = jwt.decode(token);
  return { token, expiresAt: new Date(exp * 1000) };
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
  } catch (err) {
    if (err?.name === 'TokenExpiredError') throw unauthorized('AUTH_TOKEN_EXPIRED', 'Access token expired');
    throw unauthorized('AUTH_TOKEN_INVALID', 'Access token is invalid');
  }
}

/** Creates a refresh token row and returns the raw token (only ever shown once). */
export async function issueRefreshToken(userId, { familyId = ulid(), userAgent, ip } = {}, db = prisma) {
  const raw = randomToken(48);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  const row = await db.refreshToken.create({
    data: {
      userId: BigInt(userId),
      tokenHash: sha256Hex(raw),
      familyId,
      userAgent: userAgent?.slice(0, 255),
      ip,
      expiresAt,
    },
  });
  return { raw, row };
}

export async function revokeFamily(familyId, db = prisma) {
  await db.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllForUser(userId, db = prisma) {
  await db.refreshToken.updateMany({ where: { userId: BigInt(userId), revokedAt: null }, data: { revokedAt: new Date() } });
}

/**
 * Rotates a refresh token. Reusing an already-rotated token revokes the whole family
 * (it means the token was copied), forcing the real device to log in again.
 * @returns {Promise<{ userId: bigint, refreshToken: string }>}
 */
export async function rotateRefreshToken(raw, meta = {}) {
  if (typeof raw !== 'string' || raw.length < 32) throw unauthorized('AUTH_REFRESH_INVALID', 'Refresh token is invalid');
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256Hex(raw) } });
  if (!existing) throw unauthorized('AUTH_REFRESH_INVALID', 'Refresh token is invalid');

  if (existing.revokedAt) {
    logger.warn({ userId: existing.userId.toString(), familyId: existing.familyId }, 'refresh token reuse detected');
    await revokeFamily(existing.familyId);
    throw unauthorized('AUTH_REFRESH_REUSED', 'Session expired, please log in again');
  }
  if (existing.expiresAt <= new Date()) throw unauthorized('AUTH_REFRESH_EXPIRED', 'Session expired, please log in again');

  return prisma.$transaction(async (tx) => {
    // Conditional update: only one concurrent request can rotate a given token.
    const claimed = await tx.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count !== 1) throw unauthorized('AUTH_REFRESH_REUSED', 'Session expired, please log in again');

    const { raw: next, row } = await issueRefreshToken(existing.userId, { familyId: existing.familyId, ...meta }, tx);
    await tx.refreshToken.update({ where: { id: existing.id }, data: { replacedBy: row.id } });
    return { userId: existing.userId, refreshToken: next };
  });
}

/** Revokes the family of the given token (logout from this device). Silent if unknown. */
export async function revokeByRawToken(raw) {
  if (typeof raw !== 'string' || !raw) return;
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256Hex(raw) } });
  if (existing) await revokeFamily(existing.familyId);
}
