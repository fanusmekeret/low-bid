import crypto from "node:crypto";
import argon2 from "argon2";
import type { OtpPurpose } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { sms } from "../../lib/sms/index.js";
import { AppError, badRequest, conflict, unauthorized } from "../../utils/errors.js";
import { issueTokens, sha256 } from "./tokens.js";

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const LOCK_AFTER_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;

const otpHash = (userId: bigint, code: string) => sha256(`${env().OTP_PEPPER}:${userId}:${code}`);

export async function register(input: { phone: string; password: string; full_name: string; email?: string; locale: string }) {
  const exists = await prisma.user.findUnique({ where: { phone: input.phone } });
  if (exists) throw conflict("PHONE_TAKEN", "An account with this phone number already exists");

  const buyer = await prisma.role.findUniqueOrThrow({ where: { code: "buyer" } });
  const user = await prisma.user.create({
    data: {
      phone: input.phone,
      email: input.email,
      fullName: input.full_name,
      locale: input.locale,
      passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
      roles: { create: { roleId: buyer.id } },
    },
  });
  await sendOtp(user.id, user.phone, "VERIFY_PHONE");
  return { user: publicUser(user), ...(await issueTokens(user.id)) };
}

export async function login(phone: string, password: string) {
  const user = await prisma.user.findUnique({ where: { phone } });
  // Same error for unknown phone and wrong password.
  const invalid = unauthorized("Phone number or password is incorrect");
  if (!user) {
    await argon2.hash(password); // keep timing similar
    throw invalid;
  }
  if (user.status !== "ACTIVE") throw new AppError(403, "ACCOUNT_SUSPENDED", "This account is suspended");
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(423, "ACCOUNT_LOCKED", "Too many failed attempts. Try again later");
  }
  if (!(await argon2.verify(user.passwordHash, password))) {
    const fails = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: fails >= LOCK_AFTER_FAILS ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } : { failedLogins: fails },
    });
    throw invalid;
  }
  if (user.failedLogins > 0 || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  }
  return { user: publicUser(user), ...(await issueTokens(user.id)) };
}

export async function sendOtp(userId: bigint, phone: string, purpose: OtpPurpose) {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  await prisma.otpCode.updateMany({ where: { userId, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
  await prisma.otpCode.create({
    data: { userId, purpose, codeHash: otpHash(userId, code), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });
  await sms.send(phone, `LOW BID code: ${code}. Valid for 5 minutes. Do not share it.`);
}

export async function requestOtp(phone: string, purpose: OtpPurpose) {
  const user = await prisma.user.findUnique({ where: { phone } });
  // Do not reveal whether the phone is registered.
  if (user) await sendOtp(user.id, user.phone, purpose);
}

async function consumeOtp(phone: string, code: string, purpose: OtpPurpose) {
  const user = await prisma.user.findUnique({ where: { phone } });
  const bad = badRequest("OTP_INVALID", "The code is wrong or has expired");
  if (!user) throw bad;
  const otp = await prisma.otpCode.findFirst({
    where: { userId: user.id, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) throw bad;
  const hashed = otpHash(user.id, code);
  if (!crypto.timingSafeEqual(Buffer.from(hashed), Buffer.from(otp.codeHash))) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw bad;
  }
  await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  return user;
}

export async function verifyPhone(phone: string, code: string) {
  const user = await consumeOtp(phone, code, "VERIFY_PHONE");
  const updated = await prisma.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } });
  const verified = await prisma.role.findUniqueOrThrow({ where: { code: "verified_bidder" } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: verified.id } },
    create: { userId: user.id, roleId: verified.id },
    update: {},
  });
  // New tokens so the bid permission takes effect immediately.
  return { user: publicUser(updated), ...(await issueTokens(user.id)) };
}

export async function resetPassword(phone: string, code: string, password: string) {
  const user = await consumeOtp(phone, code, "RESET_PASSWORD");
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }), failedLogins: 0, lockedUntil: null },
    }),
    prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}

export function publicUser(u: { id: bigint; phone: string; email: string | null; fullName: string; locale: string; phoneVerifiedAt: Date | null }) {
  return {
    id: u.id.toString(),
    phone: u.phone,
    email: u.email,
    full_name: u.fullName,
    locale: u.locale,
    phone_verified: u.phoneVerifiedAt !== null,
  };
}
