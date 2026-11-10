import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { unauthorized } from "../utils/errors.js";

export interface AccessClaims {
  sub: string;
  perms: string[];
  pv: boolean; // phone verified
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: bigint; perms: Set<string>; phoneVerified: boolean };
    }
  }
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, env().JWT_ACCESS_SECRET, { algorithms: ["HS256"] }) as AccessClaims;
}

function attach(req: Request, token: string) {
  const claims = verifyAccessToken(token);
  req.user = { id: BigInt(claims.sub), perms: new Set(claims.perms), phoneVerified: claims.pv };
}

/** Requires a valid access token. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(unauthorized());
  try {
    attach(req, header.slice(7));
    next();
  } catch {
    next(unauthorized("Invalid or expired token"));
  }
}

/** Attaches the user if a valid token is present; guests pass through. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      attach(req, header.slice(7));
    } catch {
      /* treat as guest */
    }
  }
  next();
}
