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
  async register(req: Request, res: Response) {
    const result = await authService.register({
      username: req.body.username,
      password: req.body.password,
      phone_number: req.body.phone_number,
      businessDayStartHour: req.body.businessDayStartHour,
    });
    return sendSuccess(res, result);
  },

  async login(req: Request, res: Response) {
    const result = await authService.login(
      req.body.username,
      req.body.password
    );
    return sendSuccess(res, result);
  },

  async me(req: Request, res: Response) {
    const actor = requireAuth(req);
    const user = await authService.getCurrentUser(actor.userId);
    return sendSuccess(res, user);
  },

  async listAdmins(req: Request, res: Response) {
    const actor = requireAuth(req);
    const admins = await authService.listAdmins(actor);
    return sendSuccess(res, admins);
  },

  async createAdmin(req: Request, res: Response) {
    const actor = requireAuth(req);
    const admin = await authService.createAdmin(actor, {
      username: req.body.username,
      phone_number: req.body.phone_number,
      password: req.body.password,
      tier: req.body.tier,
      isPayed: req.body.isPayed,
      durationMonths: req.body.durationMonths,
    });
    return sendSuccess(res, admin);
  },

  async updateAdmin(req: Request, res: Response) {
    const actor = requireAuth(req);
    const updated = await authService.updateAdmin(actor, String(req.params.id), {
      username: req.body.username,
      phone_number: req.body.phone_number,
      password: req.body.password,
      tier: req.body.tier,
      isPayed: req.body.isPayed,
      isActive: req.body.isActive,
      durationMonths: req.body.durationMonths,
    });
    return sendSuccess(res, updated);
  },

  async deleteAdmin(req: Request, res: Response) {
    const actor = requireAuth(req);
    const deleted = await authService.deleteAdmin(actor, String(req.params.id));
    return sendSuccess(res, deleted);
  },

  async adminStats(req: Request, res: Response) {
    const actor = requireAuth(req);
    const stats = await authService.getAdminStats(actor);
    return sendSuccess(res, stats);
  },

  async updateMe(req: Request, res: Response) {
    const actor = requireAuth(req);
    const result = await authService.updateMe(actor, {
      username: req.body.username,
      phone_number: req.body.phone_number,
      businessDayStartHour: req.body.businessDayStartHour,
      blockCode: req.body.blockCode,
    });
    return sendSuccess(res, result);
  },

  async refresh(req: Request, res: Response) {
    const result = await authService.refresh(req.body.refreshToken);
    return sendSuccess(res, result);
  },
};
