import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";
import { badRequest } from "../utils/errors.js";

type Part = "body" | "query" | "params";

export function validate(schema: ZodTypeAny, part: Part = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      return next(badRequest("VALIDATION_FAILED", "Request is invalid", result.error.flatten()));
    }
    // Express 4 lets us replace these objects in place.
    (req as unknown as Record<Part, unknown>)[part] = result.data;
    next();
  };
}
