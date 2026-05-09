import type { Request, Response } from "express";

import { AppError } from "../../utils/app-error";
import { sendSuccess } from "../../utils/response";
import { resolveProductImages } from "../../utils/resolve-image";
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
    return sendSuccess(res, resolveProductImages(req, result));
  }
};
