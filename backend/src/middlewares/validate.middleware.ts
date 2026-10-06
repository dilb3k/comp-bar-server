import type { NextFunction, Request, Response } from "express";
import type { ZodError, ZodTypeAny } from "zod";

import { AppError } from "../utils/app-error";
import { detectLanguage, translateMessage } from "../utils/i18n";

function formatZodError(error: ZodError, lang: string) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: translateMessage(issue.message, lang)
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
        return next(new AppError("Validation failed", 422, formatZodError(error as ZodError, detectLanguage(req.headers["accept-language"]))));
      }

      next(error);
    }
  };
}
