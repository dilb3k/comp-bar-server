import { replyToMutation } from "../idempotency/http-mutation";
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
    return replyToMutation(req,res,req.body.userId,"subscription.activate",()=>subscriptionService.activate(
      actor,
      req.body.userId,
      req.body.tier,
      req.body.durationMonths
    ));
  },

  async deactivate(req: Request, res: Response) {
    const actor = requireAuth(req);
    const userId = String(req.params.userId);
    return replyToMutation(req,res,userId,"subscription.deactivate",()=>subscriptionService.deactivate(actor,userId));
  },

  async list(_req: Request, res: Response) {
    const subs = await subscriptionService.getAllSubscriptions();
    return sendSuccess(res, subs);
  },
};
