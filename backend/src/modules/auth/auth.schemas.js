import { z } from 'zod';
import { normalizeEthiopianPhone } from '../../utils/phone.js';

export const phoneField = z
  .string({ required_error: 'Phone number is required' })
  .transform((v, ctx) => {
    const phone = normalizeEthiopianPhone(v);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid Ethiopian mobile number, e.g. 0912345678' });
      return z.NEVER;
    }
    return phone;
  });

export const passwordField = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain letters and numbers');

const nameField = z.string().trim().min(1, 'Required').max(80);

export const registerSchema = z.object({
  phone: phoneField,
  password: passwordField,
  firstName: nameField,
  lastName: nameField,
  email: z.string().trim().toLowerCase().email().max(191).optional(),
  locale: z.enum(['en', 'am']).default('en'),
});

export const loginSchema = z.object({
  phone: phoneField,
  password: z.string().min(1).max(128),
});

export const otpVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

export const refreshSchema = z.object({ refreshToken: z.string().min(32).max(200) });

export const logoutSchema = z.object({ refreshToken: z.string().max(200).optional() });

export const forgotPasswordSchema = z.object({ phone: phoneField });

export const resetPasswordSchema = z.object({
  phone: phoneField,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  newPassword: passwordField,
});
