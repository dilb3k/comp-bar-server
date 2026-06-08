import type { Request, Response } from "express";

import { AppError } from "../../utils/app-error";
import { sendSuccess } from "../../utils/response";
import { subscriptionService } from "./subscription.service";

function requireAuth(req: Request) {
  if (!req.auth) throw new AppError("Unauthorized", 401);
  return req.auth;
}

export const subscriptionController = {
  async activate(req: Request, res: Response) {
    const actor = requireAuth(req);
    const result = await subscriptionService.activate(
      actor,
      req.body.userId,
      req.body.tier,
      req.body.durationMonths
    );
    return sendSuccess(res, result);
  },

  async deactivate(req: Request, res: Response) {
    const actor = requireAuth(req);
    const userId = String(req.params.userId);
    const result = await subscriptionService.deactivate(actor, userId);
    return sendSuccess(res, result);
  },

  async list(_req: Request, res: Response) {
    const subs = await subscriptionService.getAllSubscriptions();
    return sendSuccess(res, subs);
  },
};
