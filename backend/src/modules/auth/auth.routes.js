import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { loginLimiter, otpVerifyLimiter, signupLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import {
  forgotPasswordSchema, loginSchema, logoutSchema, otpVerifySchema, refreshSchema, registerSchema, resetPasswordSchema,
} from './auth.schemas.js';
import * as auth from './auth.service.js';

const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent'), req });

export const authRouter = Router();

authRouter.post('/register', signupLimiter, validate({ body: registerSchema }), async (req, res) => {
  const result = await auth.register(req.valid.body, meta(req));
  res.status(201).json({ data: result });
});

authRouter.post('/login', loginLimiter, validate({ body: loginSchema }), async (req, res) => {
  res.json({ data: await auth.login(req.valid.body, meta(req)) });
});

authRouter.post('/refresh', validate({ body: refreshSchema }), async (req, res) => {
  res.json({ data: await auth.refresh(req.valid.body.refreshToken, meta(req)) });
});

authRouter.post('/logout', validate({ body: logoutSchema }), async (req, res) => {
  if (req.valid.body.refreshToken) await auth.logout(req.valid.body.refreshToken);
  res.status(204).end();
});

authRouter.post('/logout-all', authenticate, async (req, res) => {
  await auth.logoutEverywhere(req.auth.userId);
  res.status(204).end();
});

authRouter.post('/otp/send', authenticate, async (req, res) => {
  res.json({ data: await auth.sendPhoneVerification(req.auth.userId) });
});

authRouter.post('/otp/verify', authenticate, otpVerifyLimiter, validate({ body: otpVerifySchema }), async (req, res) => {
  res.json({ data: await auth.verifyPhone(req.auth.userId, req.valid.body.code, meta(req)) });
});

authRouter.post('/password/forgot', signupLimiter, validate({ body: forgotPasswordSchema }), async (req, res) => {
  await auth.forgotPassword(req.valid.body.phone);
  res.json({ data: { message: 'If an account exists for this number, a reset code has been sent' } });
});

authRouter.post('/password/reset', otpVerifyLimiter, validate({ body: resetPasswordSchema }), async (req, res) => {
  await auth.resetPassword(req.valid.body, meta(req));
  res.json({ data: { message: 'Password updated. Please log in' } });
});
