import type { Request, Response } from "express";

import { AppError } from "../../utils/app-error";
import { sendSuccess } from "../../utils/response";
import { getCurrentBusinessDate, getEffectiveHour } from "../../utils/business-day";
import { env } from "../../config/env";
import { inventoryService } from "../inventory/inventory.service";
import { snapshotService } from "../snapshots/snapshot.service";
import { productService } from "./product.service";

function requireAuth(req: Request) {
  if (!req.auth) {
    throw new AppError("Unauthorized", 401);
  }

  return req.auth;
}

async function rebuildTodayState(actor: any) {
  const businessHour = getEffectiveHour(actor);
  const today = getCurrentBusinessDate(businessHour, env.TIMEZONE_OFFSET);
  const [products, inventoryResult, snapshot] = await Promise.all([
    productService.getAll(actor),
    inventoryService.getByDate(actor, today, today),
    snapshotService.createOrUpdate(actor, { date: today }),
  ]);
  return { products, inventory: inventoryResult.items, inventorySummary: inventoryResult.summary, snapshot };
}

export const productController = {
  async list(req: Request, res: Response) {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    return sendSuccess(res, await productService.getAll(requireAuth(req), search));
  },

  async get(req: Request, res: Response) {
    return sendSuccess(res, await productService.getByIdentifier(requireAuth(req), String(req.params.id)));
  },

  async create(req: Request, res: Response) {
    const product = await productService.create(requireAuth(req), req.body);
    const state = await rebuildTodayState(requireAuth(req));
    return sendSuccess(res, { product, ...state }, 201);
  },

  async update(req: Request, res: Response) {
    const product = await productService.update(requireAuth(req), String(req.params.id), req.body);
    const state = await rebuildTodayState(requireAuth(req));
    return sendSuccess(res, { product, ...state });
  },

  async remove(req: Request, res: Response) {
    await productService.remove(requireAuth(req), String(req.params.id));
    const state = await rebuildTodayState(requireAuth(req));
    return sendSuccess(res, { ...state });
  }
};
