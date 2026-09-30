import type { Request, Response } from "express";

import { AppError } from "../../utils/app-error";
import { sendSuccess } from "../../utils/response";
import { alertService } from "../../services/alert.service";

function requireAuth(req: Request) {
  if (!req.auth) throw new AppError("Unauthorized", 401);
  return req.auth;
}

export const opsController = {
  async reportFailover(req: Request, res: Response) {
    const auth = requireAuth(req);
    const { event, from, to, reason } = req.body as {
      event: "failover" | "recovered";
      from: string;
      to: string;
      reason?: string;
    };

    const reportedBy = auth.username ?? auth.userId;

    if (event === "failover") {
      alertService.reportFailover({ from, to, reason, reportedBy });
    } else {
      alertService.reportFailoverRecovered({ server: to, reportedBy });
    }

    return sendSuccess(res, { received: true });
  },
};
