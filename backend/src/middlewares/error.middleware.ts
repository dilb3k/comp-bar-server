import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import multer from "multer";

import { AppError } from "../utils/app-error";
import { detectLanguage, translateMessage } from "../utils/i18n";
import { alertService } from "../services/alert.service";

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
  res.vary("Accept-Language");

  // body-parser errors can carry the raw request body (including passwords).
  // Treat malformed/oversized input as a client error without logging it.
  const parserType = error && typeof error === "object" && "type" in error ? error.type : undefined;
  if (parserType === "entity.parse.failed" || parserType === "entity.too.large") {
    const oversized = parserType === "entity.too.large";
    return res.status(oversized ? 413 : 400).json({ success: false, error: {
      message: translateMessage(oversized ? "Request body is too large" : "Invalid JSON request body", lang),
      details: null, code: oversized ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON",
    } });
  }

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

  // Raised by imageUpload (multer) when the raw upload exceeds its size cap
  // or a client sends more files/fields than the route expects. Without this
  // branch it would fall through to the generic 500 below — a client error
  // reported as a server error.
  if (error instanceof multer.MulterError) {
    const statusCode = error.code === "LIMIT_FILE_SIZE" ? 413 : 422;
    return res.status(statusCode).json({
      success: false,
      error: {
        message: translateMessage(error.message, lang),
        details: null
      }
    });
  }

  if (error instanceof AppError) {
    if (error.statusCode === 503) res.setHeader("Retry-After", "5");
    if (error.statusCode >= 500) {
      alertService.reportCriticalError({
        statusCode: error.statusCode,
        method: req.method,
        path: req.path,
        message: error.message,
      });
    }
    return res.status(error.statusCode).json({
      success: false,
      error: {
        message: translateMessage(error.message, lang),
        details: error.details ?? null,
        code: error.code ?? null
      }
    });
  }

  if (error instanceof mongoose.Error) {
    return res.status(400).json({
      success: false,
      error: {
        message: translateMessage("Validation failed", lang),
        details: null
      }
    });
  }

  // Unclassified/unexpected error: log the real details server-side for
  // debugging, but never leak raw internals (stack traces, DB/file paths,
  // library error text) to the client — return a generic, safe message.
  console.error("Unhandled error:", error);
  alertService.reportCriticalError({
    statusCode: 500,
    method: req.method,
    path: req.path,
    message: error instanceof Error ? error.message : "Unknown error",
  });

  return res.status(500).json({
    success: false,
    error: {
      message: translateMessage("Internal server error", lang),
      details: null
    }
  });
}
