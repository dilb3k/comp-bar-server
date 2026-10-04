import { Router } from "express";

import { asyncHandler } from "../../utils/async-handler";
import { validateRequest } from "../../middlewares/validate.middleware";
import { botAuth } from "../../middlewares/bot-auth.middleware";
import { imageUpload } from "../../middlewares/upload.middleware";
import { botController } from "./payment.controller";
import { registrationPhoneService } from "../auth/registration-phone.service";
import { registrationStartSchema, registrationContactSchema } from "../auth/auth.validation";
import { sendSuccess } from "../../utils/response";
import { passwordResetService } from "../auth/password-reset.service";
import { passwordResetRequestSchema, passwordResetChatConfirmSchema } from "../auth/auth.validation";
import {
  lookupUserSchema,
  linkTelegramSchema,
  createManualPaymentSchema,
  attachReceiptSchema,
  cardDetailsSchema,
  approvePaymentSchema,
  rejectPaymentSchema,
  createClickPendingSchema,
  subscriptionIdParamsSchema,
} from "./payment.validation";

// Everything here is for the hisvex-bot service only — guarded by botAuth
// (a shared secret, not a user JWT) rather than the normal authenticate().
// Mounted at /api/bot in app.ts.
const router = Router();

router.use(botAuth);

router.post("/password-reset", validateRequest({ body: passwordResetRequestSchema }), asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return sendSuccess(res, await passwordResetService.request(req.body.telegramId));
}));

router.post("/password-reset/chat", validateRequest({ body: passwordResetRequestSchema }), asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return sendSuccess(res, await passwordResetService.requestInChat(req.body.telegramId));
}));
router.post("/password-reset/chat/confirm", validateRequest({ body: passwordResetChatConfirmSchema }), asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const { token, password, telegramId } = req.body;
  return sendSuccess(res, await passwordResetService.confirm(token, password, telegramId));
}));

router.post("/registration/start", validateRequest({ body: registrationStartSchema }), asyncHandler(async (req, res) => {
  return sendSuccess(res, await registrationPhoneService.start(req.body.startToken, req.body.telegramId));
}));
router.post("/registration/confirm", validateRequest({ body: registrationContactSchema }), asyncHandler(async (req, res) => {
  return sendSuccess(res, await registrationPhoneService.confirm(req.body.telegramId, req.body.contactUserId, req.body.phone, req.body.telegramUsername));
}));

router.get("/pricing", asyncHandler(botController.pricing));

router.post("/lookup", validateRequest({ body: lookupUserSchema }), asyncHandler(botController.lookupUser));
router.post("/link-telegram", validateRequest({ body: linkTelegramSchema }), asyncHandler(botController.linkTelegram));
router.get("/lookup-by-telegram/:telegramId", asyncHandler(botController.lookupByTelegramId));
router.get("/subscription/:userId", asyncHandler(botController.subscriptionStatus));
router.get("/expiring-soon", asyncHandler(botController.expiringSoon));
router.post(
  "/expiring-soon/:subscriptionId/mark-reminded",
  validateRequest({ params: subscriptionIdParamsSchema }),
  asyncHandler(botController.markReminderSent)
);

router.post(
  "/payments/manual",
  validateRequest({ body: createManualPaymentSchema }),
  asyncHandler(botController.createManualPayment)
);
router.post(
  "/payments/:paymentId/receipt",
  // multer first: it's what actually parses a multipart body into
  // req.body/req.file — validateRequest below would see an empty req.body
  // otherwise (express.json() in app.ts only parses application/json).
  imageUpload.single("receipt"),
  validateRequest({ body: attachReceiptSchema }),
  asyncHandler(botController.attachReceipt)
);
router.post(
  "/payments/:paymentId/card-details",
  validateRequest({ body: cardDetailsSchema }),
  asyncHandler(botController.submitCardDetails)
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
