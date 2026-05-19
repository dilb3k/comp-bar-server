import type { Request, Response } from "express";
import { sendSuccess } from "../../utils/response";
import { statsService } from "./stats.service";

export const statsController = {
  async get(req: Request, res: Response) {
    const result = await statsService.getDatabaseStats();
    return sendSuccess(res, result);
  },
};
