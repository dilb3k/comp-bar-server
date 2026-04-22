import type { Request, Response } from "express";

import { AppError } from "../../utils/app-error";
import { sendSuccess } from "../../utils/response";
import { authService } from "./auth.service";

function requireAuth(req: Request) {
  if (!req.auth) {
    throw new AppError("Unauthorized", 401);
  }

  return req.auth;
}

export const authController = {
  async login(req: Request, res: Response) {
    return sendSuccess(res, await authService.login(req.body.username, req.body.password));
  },

  async me(req: Request, res: Response) {
    return sendSuccess(res, await authService.getCurrentUser(requireAuth(req).userId));
  },

  async createAdmin(req: Request, res: Response) {
    return sendSuccess(res, await authService.createAdmin(requireAuth(req), req.body), 201);
  },

  async listAdmins(req: Request, res: Response) {
    return sendSuccess(res, await authService.listAdmins(requireAuth(req)));
  }
};
