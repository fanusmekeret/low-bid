import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { ulid } from "ulid";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { unauthorized } from "../../utils/errors.js";

const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function permissionsOf(userId: bigint): Promise<string[]> {
  const rows = await prisma.rolePermission.findMany({
    where: { role: { users: { some: { userId } } } },
    select: { permission: { select: { code: true } } },
  });
  return [...new Set(rows.map((r) => r.permission.code))];
}

async function signAccess(userId: bigint) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const perms = await permissionsOf(userId);
  return jwt.sign({ perms, pv: user.phoneVerifiedAt !== null }, env().JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    subject: userId.toString(),
    expiresIn: ACCESS_TTL_SEC,
  });
}

async function newRefresh(userId: bigint, familyId: string) {
  const raw = crypto.randomBytes(48).toString("base64url");
  const row = await prisma.refreshToken.create({
    data: { userId, tokenHash: sha256(raw), familyId, expiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
  });
  return { raw, row };
}

export async function issueTokens(userId: bigint, familyId = ulid()) {
  const [access, refresh] = await Promise.all([signAccess(userId), newRefresh(userId, familyId)]);
  return { access_token: access, refresh_token: refresh.raw, expires_in: ACCESS_TTL_SEC };
}

/** Rotates a refresh token. Presenting an already-used token revokes the whole family (theft signal). */
export async function rotateRefresh(raw: string) {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!row) throw unauthorized("Invalid refresh token");
  if (row.revokedAt) {
    await prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw unauthorized("Refresh token reuse detected; please sign in again");
  }
  if (row.expiresAt < new Date()) throw unauthorized("Refresh token expired");

  const next = await newRefresh(row.userId, row.familyId);
  const claimed = await prisma.refreshToken.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: new Date(), replacedBy: next.row.id },
  });
  if (claimed.count === 0) {
    // Lost a race with another rotation of the same token: treat as reuse.
    await prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw unauthorized("Refresh token reuse detected; please sign in again");
  }
  return { access_token: await signAccess(row.userId), refresh_token: next.raw, expires_in: ACCESS_TTL_SEC };
}

export async function revokeFamilyOf(raw: string) {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (row) {
    await prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
