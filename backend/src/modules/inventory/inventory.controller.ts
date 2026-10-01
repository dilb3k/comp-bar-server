import type { Request, Response } from "express";

import { AppError } from "../../utils/app-error";
import { sendSuccess } from "../../utils/response";
import { withIdempotency } from "../idempotency/idempotency.service";
import { inventoryService } from "./inventory.service";

function requireAuth(req: Request) {
  if (!req.auth) {
    throw new AppError("Unauthorized", 401);
  }

  return req.auth;
}

export const inventoryController = {
  async getByDate(req: Request, res: Response) {
    const { from, to, date } = req.query;
    const effectiveFrom = from as string | undefined;
    const effectiveTo = to as string | undefined;
    const effectiveDate = date as string | undefined;

    if (effectiveDate && !effectiveFrom && !effectiveTo) {
      return sendSuccess(
        res,
        await inventoryService.getByDate(requireAuth(req), effectiveDate, effectiveDate)
      );
    }

    return sendSuccess(
      res,
      await inventoryService.getByDate(requireAuth(req), effectiveFrom, effectiveTo)
    );
  },

  async getRange(req: Request, res: Response) {
    return sendSuccess(
      res,
      await inventoryService.getRange(requireAuth(req), String(req.query.from), String(req.query.to))
    );
  },

  async startDay(req: Request, res: Response) {
    const auth = requireAuth(req);
    const { idempotencyKey: bodyKey, ...payload } = req.body;
    const idempotencyKey=req.get("Idempotency-Key")??bodyKey;
    const { status, data } = await withIdempotency(auth.userId, idempotencyKey, async () => ({
      status: 201,
      data: await inventoryService.startDay(auth, payload),
    }), { operation: "inventory.startDay", payload });
    return sendSuccess(res, data, status);
  },

  async bulkCurrent(req: Request, res: Response) {
    const auth = requireAuth(req);
    const { idempotencyKey: bodyKey, ...payload } = req.body;
    const idempotencyKey=req.get("Idempotency-Key")??bodyKey;
    const { status, data } = await withIdempotency(auth.userId, idempotencyKey, async () => ({
      status: 200,
      data: await inventoryService.bulkUpdateCurrent(auth, payload),
    }), { operation: "inventory.bulkUpdateCurrent", payload });
    return sendSuccess(res, data, status);
  },

  async sales(req: Request, res: Response) {
    const auth = requireAuth(req);
    const { idempotencyKey: bodyKey, ...payload } = req.body;
    const idempotencyKey=req.get("Idempotency-Key")??bodyKey;
    if (payload.lines.some((line: any) => line.expectedBuyPrice === undefined || line.expectedUnit === undefined || line.expectedStockEpoch === undefined)) {
      throw new AppError("Update client to submit the sale cost, unit and stock baseline", 409, undefined, "CLIENT_UPGRADE_REQUIRED");
    }
    const { status, data } = await withIdempotency(auth.userId, idempotencyKey, async () => ({
      status: 200,
      data: await inventoryService.sales(auth, payload),
    }), { operation: "inventory.sales", payload });
    return sendSuccess(res, data, status);
  },

  async dashboard(req: Request, res: Response) {
    return sendSuccess(res, await inventoryService.getDashboard(requireAuth(req)));
  },

  async preview(req: Request, res: Response) {
    return sendSuccess(res, await inventoryService.getPreview(requireAuth(req)));
  },
};
