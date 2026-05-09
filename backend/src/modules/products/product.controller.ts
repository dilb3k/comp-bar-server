import type { Request, Response } from "express";

import { AppError } from "../../utils/app-error";
import { sendSuccess } from "../../utils/response";
import { productService } from "./product.service";

function requireAuth(req: Request) {
  if (!req.auth) {
    throw new AppError("Unauthorized", 401);
  }

  return req.auth;
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
    return sendSuccess(res, await productService.create(requireAuth(req), req.body), 201);
  },

  async update(req: Request, res: Response) {
    return sendSuccess(res, await productService.update(requireAuth(req), String(req.params.id), req.body));
  },

  async remove(req: Request, res: Response) {
    return sendSuccess(res, await productService.remove(requireAuth(req), String(req.params.id)));
  }
};
