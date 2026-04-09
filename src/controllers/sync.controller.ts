import { NextFunction, Request, Response } from "express";
import { syncService } from "../services/sync.service";
import { HttpError } from "../utils/http-error";

export const syncController = {
  async push(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new HttpError(401, "Unauthorized");
      const result = await syncService.push({
        workspaceId: req.auth.workspaceId,
        userId: req.auth.userId,
        deviceId: req.body.deviceId,
        actions: req.body.actions
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  async pull(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new HttpError(401, "Unauthorized");
      const result = await syncService.pull({
        workspaceId: req.auth.workspaceId,
        lastSync: req.query.lastSync as string,
        page: req.query.page as string | undefined,
        pageSize: req.query.pageSize as string | undefined
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
};
