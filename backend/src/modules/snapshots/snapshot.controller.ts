import type { Request, Response } from "express";

import { AppError } from "../../utils/app-error";
import { sendSuccess } from "../../utils/response";
import { snapshotService } from "./snapshot.service";

function requireAuth(req: Request) {
  if (!req.auth) {
    throw new AppError("Unauthorized", 401);
  }

  return req.auth;
}

export const snapshotController = {
  async getDaily(req: Request, res: Response) {
    return sendSuccess(res, await snapshotService.getDaily(requireAuth(req), String(req.query.date)));
  },

  async getRange(req: Request, res: Response) {
    return sendSuccess(
      res,
      await snapshotService.getRange(requireAuth(req), String(req.query.from), String(req.query.to))
    );
  },

  async upsert(req: Request, res: Response) {
    return sendSuccess(res, await snapshotService.createOrUpdate(requireAuth(req), req.body), 201);
  }
};
