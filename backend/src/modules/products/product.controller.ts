import type { Request, Response } from "express";

import { AppError } from "../../utils/app-error";
import { sendSuccess } from "../../utils/response";
import { resolveProductImages } from "../../utils/resolve-image";
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
    const products = await productService.getAll(requireAuth(req), search);
    return sendSuccess(res, resolveProductImages(req, products));
  },

  async get(req: Request, res: Response) {
    const product = await productService.getByIdentifier(requireAuth(req), String(req.params.id));
    return sendSuccess(res, resolveProductImages(req, product));
  },

  async create(req: Request, res: Response) {
    const product = await productService.create(requireAuth(req), req.body);
    return sendSuccess(res, resolveProductImages(req, product), 201);
  },

  async update(req: Request, res: Response) {
    const product = await productService.update(requireAuth(req), String(req.params.id), req.body);
    return sendSuccess(res, resolveProductImages(req, product));
  },

  async remove(req: Request, res: Response) {
    return sendSuccess(res, await productService.remove(requireAuth(req), String(req.params.id)));
  }
};
