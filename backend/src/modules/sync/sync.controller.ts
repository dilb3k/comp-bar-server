import type { Request, Response } from "express";

import { sendSuccess } from "../../utils/response";
import { syncService } from "./sync.service";

export const syncController = {
  async sync(req: Request, res: Response) {
    return sendSuccess(res, await syncService.sync(req.body));
  }
};
