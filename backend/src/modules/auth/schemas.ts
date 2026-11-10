import { z } from "zod";

/** Accepts 09XXXXXXXX, 07XXXXXXXX, 2519..., +2519... and normalises to +2519XXXXXXXX / +2517XXXXXXXX. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  const m = digits.match(/^(?:\+?251|0)?([79]\d{8})$/);
  return m ? `+251${m[1]}` : null;
}

const phone = z.string().transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid Ethiopian mobile number" });
    return z.NEVER;
  }
  return p;
});
const password = z.string().min(8).max(128);

export const registerSchema = z.object({
  phone,
  password,
  full_name: z.string().trim().min(2).max(120),
  email: z.string().email().optional(),
  locale: z.enum(["en", "am"]).default("en"),
});
export const loginSchema = z.object({ phone, password });
export const otpSendSchema = z.object({ phone, purpose: z.enum(["VERIFY_PHONE", "RESET_PASSWORD"]).default("VERIFY_PHONE") });
export const otpVerifySchema = z.object({ phone, code: z.string().regex(/^\d{6}$/) });
export const refreshSchema = z.object({ refresh_token: z.string().min(20) });
export const resetSchema = z.object({ phone, code: z.string().regex(/^\d{6}$/), password });
