import type { Request, Response } from "express";

import { sendSuccess } from "../../utils/response";
import { snapshotService } from "./snapshot.service";

export const snapshotController = {
  async getDaily(req: Request, res: Response) {
    return sendSuccess(res, await snapshotService.getDaily(String(req.query.date)));
  },

  async getRange(req: Request, res: Response) {
    return sendSuccess(
      res,
      await snapshotService.getRange(String(req.query.from), String(req.query.to))
    );
  },

  async upsert(req: Request, res: Response) {
    return sendSuccess(res, await snapshotService.createOrUpdate(req.body), 201);
  }
};
