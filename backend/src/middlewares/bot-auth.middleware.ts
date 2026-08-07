import type { NextFunction, Request, Response } from "express";

import { env } from "../config/env";
import { AppError } from "../utils/app-error";

// Guards the /api/bot/* routes the hisvex-bot service calls. This is
// deliberately NOT the normal user authenticate() middleware — the bot acts
// on behalf of many different Hisvex accounts (looked up by phone number),
// so it authenticates itself as a trusted service via a single shared
// secret rather than any one user's JWT.
//
// Fails closed: if BOT_INTERNAL_SECRET isn't configured, every /api/bot
// route is refused rather than silently left open (same pattern as
// production refusing to boot without JWT_REFRESH_SECRET).
export function botAuth(req: Request, _res: Response, next: NextFunction) {
  if (!env.BOT_INTERNAL_SECRET) {
    return next(new AppError("Bot integration is not configured", 503));
  }

  const provided = req.headers["x-bot-secret"];
  if (typeof provided !== "string" || provided !== env.BOT_INTERNAL_SECRET) {
    return next(new AppError("Unauthorized", 401));
  }

  return next();
}
