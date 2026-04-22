import type { Request, Response } from "express";

import { AppError } from "../../utils/app-error";
import { sendSuccess } from "../../utils/response";
import { inventoryService } from "./inventory.service";

function requireAuth(req: Request) {
  if (!req.auth) {
    throw new AppError("Unauthorized", 401);
  }

  return req.auth;
}

export const inventoryController = {
  async getByDate(req: Request, res: Response) {
    return sendSuccess(res, await inventoryService.getByDate(requireAuth(req), String(req.query.date)));
  },

  async getRange(req: Request, res: Response) {
    return sendSuccess(
      res,
      await inventoryService.getRange(requireAuth(req), String(req.query.from), String(req.query.to))
    );
  },

  async startDay(req: Request, res: Response) {
    return sendSuccess(res, await inventoryService.startDay(requireAuth(req), req.body), 201);
  },

  async bulkCurrent(req: Request, res: Response) {
    return sendSuccess(res, await inventoryService.bulkUpdateCurrent(requireAuth(req), req.body));
  }
};
