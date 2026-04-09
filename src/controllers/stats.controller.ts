import { NextFunction, Request, Response } from "express";
import { statsService } from "../services/stats.service";
import { HttpError } from "../utils/http-error";

export const statsController = {
  async summary(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new HttpError(401, "Unauthorized");
      const data = await statsService.summary({
        workspaceId: req.auth.workspaceId,
        dateFrom: req.query.dateFrom as string | undefined,
        dateTo: req.query.dateTo as string | undefined
      });

      res.status(200).json({
        success: true,
        data
      });
    } catch (error) {
      next(error);
    }
  },

  async products(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new HttpError(401, "Unauthorized");
      const data = await statsService.byProduct({
        workspaceId: req.auth.workspaceId,
        dateFrom: req.query.dateFrom as string | undefined,
        dateTo: req.query.dateTo as string | undefined
      });

      res.status(200).json({
        success: true,
        data
      });
    } catch (error) {
      next(error);
    }
  }
};
