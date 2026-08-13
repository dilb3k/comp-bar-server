import { Router } from "express";

import { asyncHandler } from "../../utils/async-handler";
import { validateRequest } from "../../middlewares/validate.middleware";
import { botAuth } from "../../middlewares/bot-auth.middleware";
import { botController } from "./payment.controller";
import {
  lookupUserSchema,
  linkTelegramSchema,
  createManualPaymentSchema,
  attachReceiptSchema,
  approvePaymentSchema,
  rejectPaymentSchema,
  createClickPendingSchema,
} from "./payment.validation";

// Everything here is for the hisvex-bot service only — guarded by botAuth
// (a shared secret, not a user JWT) rather than the normal authenticate().
// Mounted at /api/bot in app.ts.
const router = Router();

router.use(botAuth);

router.get("/pricing", asyncHandler(botController.pricing));

router.post("/lookup", validateRequest({ body: lookupUserSchema }), asyncHandler(botController.lookupUser));
router.post("/link-telegram", validateRequest({ body: linkTelegramSchema }), asyncHandler(botController.linkTelegram));
router.get("/lookup-by-telegram/:telegramId", asyncHandler(botController.lookupByTelegramId));
router.get("/subscription/:userId", asyncHandler(botController.subscriptionStatus));
router.get("/expiring-soon", asyncHandler(botController.expiringSoon));

router.post(
  "/payments/manual",
  validateRequest({ body: createManualPaymentSchema }),
  asyncHandler(botController.createManualPayment)
);
router.post(
  "/payments/:paymentId/receipt",
  validateRequest({ body: attachReceiptSchema }),
  asyncHandler(botController.attachReceipt)
);
router.post(
  "/payments/:paymentId/approve",
  validateRequest({ body: approvePaymentSchema }),
  asyncHandler(botController.approvePayment)
);
router.post(
  "/payments/:paymentId/reject",
  validateRequest({ body: rejectPaymentSchema }),
  asyncHandler(botController.rejectPayment)
);
router.get("/payments/pending", asyncHandler(botController.listPending));
router.get("/payments/user/:userId", asyncHandler(botController.listByUser));
router.get("/payments/:paymentId", asyncHandler(botController.getPayment));

router.post(
  "/payments/click",
  validateRequest({ body: createClickPendingSchema }),
  asyncHandler(botController.createClickPending)
);

export const botRoutes = router;
