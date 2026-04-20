import type { NextFunction, Request, Response } from "express";
import type { ZodError, ZodTypeAny } from "zod";

import { AppError } from "../utils/app-error";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message
  }));
}

export function validateRequest(schema: {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schema.body) {
        req.body = schema.body.parse(req.body);
      }

      if (schema.query) {
        req.query = schema.query.parse(req.query);
      }

      if (schema.params) {
        req.params = schema.params.parse(req.params);
      }

      next();
    } catch (error) {
      if (error instanceof Error && "issues" in error) {
        return next(new AppError("Validation failed", 422, formatZodError(error as ZodError)));
      }

      next(error);
    }
  };
}
