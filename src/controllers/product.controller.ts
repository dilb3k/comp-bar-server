import { NextFunction, Request, Response } from "express";
import { productService } from "../services/product.service";
import { HttpError } from "../utils/http-error";

export const productController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new HttpError(401, "Unauthorized");
      const product = await productService.create({
        workspaceId: req.auth.workspaceId,
        actorId: req.auth.userId,
        ...req.body
      });
      res.status(201).json({
        success: true,
        data: product
      });
    } catch (error) {
      next(error);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new HttpError(401, "Unauthorized");
      const result = await productService.update({
        workspaceId: req.auth.workspaceId,
        actorId: req.auth.userId,
        id: req.params.id,
        ...req.body
      });

      res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new HttpError(401, "Unauthorized");
      const result = await productService.list({
        workspaceId: req.auth.workspaceId,
        page: req.query.page as string | undefined,
        pageSize: req.query.pageSize as string | undefined,
        updatedAfter: req.query.updatedAfter as string | undefined,
        updatedBefore: req.query.updatedBefore as string | undefined
      });
      res.status(200).json({
        success: true,
        ...result
      });
    } catch (error) {
      next(error);
    }
  }
};
