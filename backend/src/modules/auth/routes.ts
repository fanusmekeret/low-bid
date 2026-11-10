import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { rateLimit } from "../../middleware/rateLimit.js";
import { ah } from "../../utils/async.js";
import * as auth from "./service.js";
import { revokeFamilyOf, rotateRefresh } from "./tokens.js";
import { loginSchema, otpSendSchema, otpVerifySchema, refreshSchema, registerSchema, resetSchema } from "./schemas.js";

export const authRoutes = Router();

const byPhoneIp = (req: { body: { phone?: string }; ip?: string }) => `${req.body.phone ?? "-"}:${req.ip}`;

authRoutes.post(
  "/auth/register",
  rateLimit("register", 5, 3600, (req) => req.ip ?? "-"),
  validate(registerSchema),
  ah(async (req, res) => res.status(201).json({ data: await auth.register(req.body) })),
);

authRoutes.post(
  "/auth/login",
  validate(loginSchema),
  rateLimit("login", 5, 15 * 60, byPhoneIp),
  ah(async (req, res) => res.json({ data: await auth.login(req.body.phone, req.body.password) })),
);

authRoutes.post(
  "/auth/otp/send",
  validate(otpSendSchema),
  rateLimit("otp", 3, 15 * 60, byPhoneIp),
  ah(async (req, res) => {
    await auth.requestOtp(req.body.phone, req.body.purpose);
    res.json({ data: { sent: true } });
  }),
);

authRoutes.post(
  "/auth/otp/verify",
  validate(otpVerifySchema),
  rateLimit("otp-verify", 10, 15 * 60, byPhoneIp),
  ah(async (req, res) => res.json({ data: await auth.verifyPhone(req.body.phone, req.body.code) })),
);

authRoutes.post(
  "/auth/refresh",
  validate(refreshSchema),
  ah(async (req, res) => res.json({ data: await rotateRefresh(req.body.refresh_token) })),
);

authRoutes.post(
  "/auth/logout",
  validate(refreshSchema),
  ah(async (req, res) => {
    await revokeFamilyOf(req.body.refresh_token);
    res.json({ data: { ok: true } });
  }),
);

authRoutes.post(
  "/auth/password/forgot",
  validate(otpSendSchema),
  rateLimit("otp", 3, 15 * 60, byPhoneIp),
  ah(async (req, res) => {
    await auth.requestOtp(req.body.phone, "RESET_PASSWORD");
    res.json({ data: { sent: true } });
  }),
);

authRoutes.post(
  "/auth/password/reset",
  validate(resetSchema),
  rateLimit("otp-verify", 10, 15 * 60, byPhoneIp),
  ah(async (req, res) => {
    await auth.resetPassword(req.body.phone, req.body.code, req.body.password);
    res.json({ data: { ok: true } });
  }),
);
