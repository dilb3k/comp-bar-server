import type { Request, Response } from "express";

import { sendSuccess } from "../../utils/response";
import { inventoryService } from "./inventory.service";

export const inventoryController = {
  async getByDate(req: Request, res: Response) {
    return sendSuccess(res, await inventoryService.getByDate(String(req.query.date)));
  },

  async getRange(req: Request, res: Response) {
    return sendSuccess(
      res,
      await inventoryService.getRange(String(req.query.from), String(req.query.to))
    );
  },

  async startDay(req: Request, res: Response) {
    return sendSuccess(res, await inventoryService.startDay(req.body), 201);
  },

  async bulkCurrent(req: Request, res: Response) {
    return sendSuccess(res, await inventoryService.bulkUpdateCurrent(req.body));
  }
};
