import type { Request, Response } from "express";

import { AppError } from "../../utils/app-error";
import { sendSuccess } from "../../utils/response";
import { debtorService } from "./debtor.service";

function requireAuth(req: Request) {
  if (!req.auth) throw new AppError("Unauthorized", 401);
  return req.auth;
}

export const debtorController = {
  async list(_req: Request, res: Response) {
    const auth = requireAuth(_req);
    return sendSuccess(res, await debtorService.getAll(auth));
  },

  async get(req: Request, res: Response) {
    const auth = requireAuth(req);
    return sendSuccess(res, await debtorService.getById(auth, String(req.params.id)));
  },

  async create(req: Request, res: Response) {
    const auth = requireAuth(req);
    return sendSuccess(res, await debtorService.create(auth, req.body), 201);
  },

  async update(req: Request, res: Response) {
    const auth = requireAuth(req);
    return sendSuccess(res, await debtorService.update(auth, String(req.params.id), req.body));
  },

  async adjust(req: Request, res: Response) {
    const auth = requireAuth(req);
    return sendSuccess(res, await debtorService.adjust(auth, String(req.params.id), req.body));
  },

  async remove(req: Request, res: Response) {
    const auth = requireAuth(req);
    return sendSuccess(res, await debtorService.remove(auth, String(req.params.id)));
  },
};
