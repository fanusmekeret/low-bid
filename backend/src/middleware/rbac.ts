import type { NextFunction, Request, Response } from "express";
import { forbidden, unauthorized } from "../utils/errors.js";

export function requirePermission(...codes: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    const ok = codes.every((c) => req.user!.perms.has(c));
    next(ok ? undefined : forbidden());
  };
}
