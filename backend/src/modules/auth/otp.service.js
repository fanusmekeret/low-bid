import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { hmacSha256Hex, randomNumericCode, safeEqualHex } from '../../utils/crypto.js';
import { AppError, badRequest, tooMany } from '../../utils/errors.js';
import { sendSms } from '../../services/sms/index.js';

export const OTP_PURPOSE = Object.freeze({
  VERIFY_PHONE: 'VERIFY_PHONE',
  RESET_PASSWORD: 'RESET_PASSWORD',
  LOGIN: 'LOGIN',
});

const hashCode = (phone, purpose, code) => hmacSha256Hex(env.OTP_PEPPER, `${phone}|${purpose}|${code}`);

const MESSAGES = {
  VERIFY_PHONE: {
    en: (c, m) => `Your LOW BID verification code is ${c}. It expires in ${m} minutes. Do not share it.`,
    am: (c, m) => `የLOW BID ማረጋገጫ ኮድዎ ${c} ነው። በ${m} ደቂቃ ውስጥ ያልፍበታል። ለማንም አያጋሩ።`,
  },
  RESET_PASSWORD: {
    en: (c, m) => `Your LOW BID password reset code is ${c}. It expires in ${m} minutes. Do not share it.`,
    am: (c, m) => `የLOW BID የይለፍ ቃል መቀየሪያ ኮድዎ ${c} ነው። በ${m} ደቂቃ ውስጥ ያልፍበታል። ለማንም አያጋሩ።`,
  },
  LOGIN: {
    en: (c, m) => `Your LOW BID login code is ${c}. It expires in ${m} minutes.`,
    am: (c, m) => `የLOW BID መግቢያ ኮድዎ ${c} ነው። በ${m} ደቂቃ ውስጥ ያልፍበታል።`,
  },
};

/**
 * Creates and sends an OTP. Enforces a resend cooldown and a 10-minute cap per phone + purpose.
 * @returns {Promise<{ expiresAt: Date, resendAfterSeconds: number }>}
 */
export async function sendOtp({ phone, purpose, userId = null, locale = 'en' }) {
  const now = Date.now();
  const recent = await prisma.otpCode.findMany({
    where: { phone, purpose, createdAt: { gte: new Date(now - 10 * 60_000) } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  if (recent[0]) {
    const waitMs = recent[0].createdAt.getTime() + env.OTP_RESEND_COOLDOWN_SECONDS * 1000 - now;
    if (waitMs > 0) {
      throw tooMany('OTP_COOLDOWN', 'Please wait before requesting another code', { retryAfterSeconds: Math.ceil(waitMs / 1000) });
    }
  }
  if (recent.length >= env.OTP_MAX_PER_10_MIN) {
    throw tooMany('OTP_LIMIT', 'Too many codes requested. Try again in 10 minutes', { retryAfterSeconds: 600 });
  }

  const code = randomNumericCode(6);
  const expiresAt = new Date(now + env.OTP_TTL_SECONDS * 1000);

  // Older unused codes for this phone/purpose stop working once a new one is issued.
  const [, created] = await prisma.$transaction([
    prisma.otpCode.updateMany({ where: { phone, purpose, consumedAt: null }, data: { consumedAt: new Date() } }),
    prisma.otpCode.create({
      data: { phone, purpose, userId: userId === null ? null : BigInt(userId), codeHash: hashCode(phone, purpose, code), expiresAt },
    }),
  ]);

  const minutes = Math.round(env.OTP_TTL_SECONDS / 60);
  const template = MESSAGES[purpose][locale === 'am' ? 'am' : 'en'];
  try {
    await sendSms(phone, template(code, minutes));
  } catch {
    // Undo so the failed attempt does not count against the cooldown or the 10-minute cap.
    await prisma.otpCode.delete({ where: { id: created.id } }).catch(() => {});
    throw new AppError(502, 'SMS_SEND_FAILED', 'We could not send the SMS. Please try again');
  }

  return { expiresAt, resendAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS };
}

/**
 * Checks a code. Consumes it on success; counts the attempt on failure.
 * Throws AppError 400 with a stable code on any failure.
 */
export async function verifyOtp({ phone, purpose, code }) {
  if (!/^\d{6}$/.test(String(code))) throw badRequest('OTP_INVALID', 'The code is incorrect');

  const otp = await prisma.otpCode.findFirst({
    where: { phone, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp || otp.expiresAt <= new Date()) throw badRequest('OTP_EXPIRED', 'The code has expired. Request a new one');
  if (otp.attempts >= env.OTP_MAX_ATTEMPTS) throw badRequest('OTP_TOO_MANY_ATTEMPTS', 'Too many wrong attempts. Request a new code');

  const ok = safeEqualHex(otp.codeHash, hashCode(phone, purpose, String(code)));
  if (!ok) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    const left = env.OTP_MAX_ATTEMPTS - otp.attempts - 1;
    throw badRequest('OTP_INVALID', 'The code is incorrect', { attemptsLeft: Math.max(left, 0) });
  }

  // Conditional consume so the same code cannot be used twice concurrently.
  const consumed = await prisma.otpCode.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (consumed.count !== 1) throw badRequest('OTP_EXPIRED', 'The code has expired. Request a new one');
  return true;
}
