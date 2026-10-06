import type { Request, Response } from "express";

import { AppError } from "../../utils/app-error";
import { detectLanguage, translateMessage } from "../../utils/i18n";
import { sendSuccess } from "../../utils/response";
import { syncService } from "./sync.service";

function requireAuth(req: Request) {
  if (!req.auth) {
    throw new AppError("Unauthorized", 401);
  }

  return req.auth;
}

export const syncController = {
  async sync(req: Request, res: Response) {
    const result = await syncService.sync(requireAuth(req), req.body);
    const lang = detectLanguage(req.headers["accept-language"]);
    return sendSuccess(res, {
      ...result,
      rejected: result.rejected.map(item => item.message ? { ...item, message: translateMessage(item.message, lang) } : item),
    });
  }
};
