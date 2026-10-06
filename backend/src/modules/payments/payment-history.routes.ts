import { Router } from "express";
import { z } from "zod";
import { authorize } from "../auth/auth.middleware";
import { validateRequest } from "../../middlewares/validate.middleware";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { AppError } from "../../utils/app-error";
import { PaymentReceiptModel } from "./payment-receipt.model";
import {
  listPaymentHistory,
  type PaymentHistoryQuery,
} from "./payment-history.service";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
  );
export const paymentHistoryQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    q: z.string().trim().max(100).optional(),
    status: z
      .enum([
        "pending",
        "provisioned",
        "approved",
        "completed",
        "rejected",
        "cancelled",
      ])
      .optional(),
    method: z.enum(["manual_card", "click"]).optional(),
    tier: z.enum(["bor", "pro"]).optional(),
    from: date.optional(),
    to: date.optional(),
  })
  .refine(
    (value) => !value.from || !value.to || value.from <= value.to,
    "from must be <= to",
  );

const router = Router();
router.use(authorize("superAdmin"));
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
router.get(
  "/",
  validateRequest({ query: paymentHistoryQuerySchema }),
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await listPaymentHistory(req.query as unknown as PaymentHistoryQuery),
    ),
  ),
);
router.get(
  "/:id/receipt",
  validateRequest({
    params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }),
  }),
  asyncHandler(async (req, res) => {
    const receipt = await PaymentReceiptModel.findOne({
      paymentId: req.params.id,
    }).select("+bytes");
    if (!receipt) throw new AppError("Payment receipt not found", 404);
    if (
      !["image/webp", "image/jpeg", "image/png"].includes(receipt.contentType)
    )
      throw new AppError("Invalid receipt format", 422);
    res.setHeader("Content-Type", receipt.contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(Buffer.from(receipt.bytes));
  }),
);
export const paymentHistoryRoutes = router;
