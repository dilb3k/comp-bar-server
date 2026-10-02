import type { Request, Response } from "express";
import { replyToMutation } from "../idempotency/http-mutation";
import { AppError } from "../../utils/app-error";
import { sendSuccess } from "../../utils/response";
import { procurementService } from "./procurement.service";

function requireAuth(req: Request) {
  if (!req.auth) {
    throw new AppError("Unauthorized", 401);
  }
  return req.auth;
}

export const procurementController = {
  async submit(req: Request, res: Response) {
    const auth = requireAuth(req);
    return replyToMutation(
      req,
      res,
      auth.userId,
      "procurement.submit",
      async () => ({ procurement: await procurementService.submitBatch(auth, req.body.items) }),
      201,
    );
  },

  async list(req: Request, res: Response) {
    const auth = requireAuth(req);
    const { from, to } = req.query as { from?: string; to?: string };
    const procurements = await procurementService.list(auth, from, to);
    return sendSuccess(res, procurements);
  },
};
