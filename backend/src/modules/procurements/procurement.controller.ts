import type { Request, Response } from "express";
import { replyToMutation } from "../idempotency/http-mutation";
import { AppError } from "../../utils/app-error";
import { sendSuccess } from "../../utils/response";
import {
  procurementAnalytics,
  procurementSummary,
  requireProcurementFinance,
  type AnalyticsQuery,
} from "./procurement.analytics";
import { procurementLedger } from "./procurement.ledger";
import { detectLanguage } from "../../utils/i18n";
import { exportReport } from "../../lib/report-worker";
import { analyticsGate, exportGate } from "../../lib/work-gate";
import { cachedOwnerRead } from "../../lib/cached-owner-read";
import { ProcurementModel, serializeProcurement } from "./procurement.model";
import { procurementService } from "./procurement.service";

function requireAuth(req: Request) {
  if (!req.auth) {
    throw new AppError("Unauthorized", 401);
  }
  return req.auth;
}

export const procurementController = {
  async analytics(req: Request, res: Response) {
    requireProcurementFinance(requireAuth(req));
    return cachedOwnerRead(req, res, "procurement.analytics", () => analyticsGate.run(() => procurementAnalytics(requireAuth(req), req.query as AnalyticsQuery)));
  },
  async summary(req: Request, res: Response) {
    return cachedOwnerRead(req, res, "procurement.summary", () => analyticsGate.run(() => procurementSummary(requireAuth(req))));
  },
  async detail(req: Request, res: Response) {
    const auth = requireAuth(req);
    const receipt = await ProcurementModel.findOne({
      ownerAdminId: auth.userId,
      localId: req.params.id,
    }).lean();
    if (!receipt) throw new AppError("Procurement not found", 404);
    return sendSuccess(res, serializeProcurement(receipt));
  },
  async export(req: Request, res: Response) {
    const auth = requireAuth(req);
    requireProcurementFinance(auth);
    const format = (req.query.format ?? "csv") as "csv" | "xlsx" | "pdf";
    return exportGate.run(async () => {
    const data = req.query.report === "receipts"
      ? await procurementLedger(auth, req.query as AnalyticsQuery, detectLanguage(req.headers["accept-language"]))
      : await procurementAnalytics(auth, req.query as AnalyticsQuery);
    const output = await exportReport(data, format);
    res.setHeader("Content-Type", output.mime);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="hisvex-procurement-${data.from}-${data.to}.${format}"`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(output.body);
    });
  },
  async submit(req: Request, res: Response) {
    const auth = requireAuth(req);
    return replyToMutation(
      req,
      res,
      auth.userId,
      "procurement.submit",
      async () => ({
        procurement: await procurementService.submitBatch(
          auth,
          req.body.items,
          req.body.supplier,
        ),
      }),
      201,
    );
  },

  async list(req: Request, res: Response) {
    const auth = requireAuth(req);
    const { from, to } = req.query as {
      from?: string;
      to?: string;
      supplier?: string;
      product?: string;
      page?: number;
      limit?: number;
    };
    const procurements = await procurementService.list(
      auth,
      from,
      to,
      req.query as any,
    );
    return sendSuccess(res, procurements);
  },
};
