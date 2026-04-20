import type { Request, Response } from "express";

import { sendSuccess } from "../../utils/response";
import { productService } from "./product.service";

export const productController = {
  async list(req: Request, res: Response) {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    return sendSuccess(res, await productService.getAll(search));
  },

  async get(req: Request, res: Response) {
    return sendSuccess(res, await productService.getByIdentifier(String(req.params.id)));
  },

  async create(req: Request, res: Response) {
    return sendSuccess(res, await productService.create(req.body), 201);
  },

  async update(req: Request, res: Response) {
    return sendSuccess(res, await productService.update(String(req.params.id), req.body));
  },

  async remove(req: Request, res: Response) {
    return sendSuccess(res, await productService.remove(String(req.params.id)));
  }
};
