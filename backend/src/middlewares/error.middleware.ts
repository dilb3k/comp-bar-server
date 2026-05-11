import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";

import { AppError } from "../utils/app-error";
import { detectLanguage, translateMessage } from "../utils/i18n";

function getLang(req: Request): string {
  return detectLanguage(req.headers["accept-language"]);
}

export function errorMiddleware(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const lang = getLang(req);

  if (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "number" &&
    (error as { code: number }).code === 11000
  ) {
    return res.status(409).json({
      success: false,
      error: {
        message: translateMessage("Duplicate value", lang),
        details: null
      }
    });
  }

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      error: {
        message: translateMessage(error.message, lang),
        details: error.details ?? null
      }
    });
  }

  if (error instanceof mongoose.Error) {
    return res.status(400).json({
      success: false,
      error: {
        message: error.message,
        details: null
      }
    });
  }

  const message = error instanceof Error ? error.message : "Internal server error";

  return res.status(500).json({
    success: false,
    error: {
      message: translateMessage(message, lang),
      details: null
    }
  });
}
