import type { NextFunction, Request, Response } from "express";

import { AppError } from "../utils/app-error";
import { detectLanguage, translateMessage } from "../utils/i18n";

export function notFoundMiddleware(req: Request, _res: Response, next: NextFunction) {
  const lang = detectLanguage(req.headers["accept-language"]);
  next(new AppError(`${translateMessage("Route not found", lang)}: ${req.method} ${req.originalUrl}`, 404));
}
