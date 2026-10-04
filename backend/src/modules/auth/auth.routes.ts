import { Router } from "express";

import { asyncHandler } from "../../utils/async-handler";
import { validateRequest } from "../../middlewares/validate.middleware";
import { authLimiter } from "../../middlewares/rate-limit.middleware";
import { authController } from "./auth.controller";
import { authenticate, authorize } from "./auth.middleware";
import { createAdminSchema, loginSchema, loginWithPhoneSchema, refreshSchema, registerSchema, updateAdminSchema, updateMeSchema, verifySessionChallengeSchema } from "./auth.validation";

const router = Router();

// Keep a stable API contract. The service rejects disabled signup before DB work.
router.post("/register", authLimiter, validateRequest({ body: registerSchema }), asyncHandler(authController.register));

router.post("/session/heartbeat", authenticate(), (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, data: { active: true } });
});

router.post(
  "/login",
  authLimiter,
  validateRequest({ body: loginSchema }),
  asyncHandler(authController.login)
);

router.post(
  "/login/procurement",
  authLimiter,
  validateRequest({ body: loginSchema }),
  asyncHandler(authController.loginAsProcurementAgent)
);

router.post(
  "/login/verify-phone",
  authLimiter,
  validateRequest({ body: loginWithPhoneSchema }),
  asyncHandler(authController.loginWithPhoneVerification)
);

router.post(
  "/verify-session-challenge",
  authLimiter,
  validateRequest({ body: verifySessionChallengeSchema }),
  asyncHandler(authController.verifySessionChallenge)
);

router.post(
  "/logout",
  authenticate({ allowStale: true }),
  asyncHandler(authController.logout)
);

router.post(
  "/refresh",
  authLimiter,
  validateRequest({ body: refreshSchema }),
  asyncHandler(authController.refresh)
);

router.get(
  "/me",
  authenticate(),
  asyncHandler(authController.me)
);

router.put(
  "/me",
  authenticate(),
  validateRequest({ body: updateMeSchema }),
  asyncHandler(authController.updateMe)
);

router.get(
  "/admins",
  authenticate(),
  authorize("superAdmin"),
  asyncHandler(authController.listAdmins)
);

router.get(
  "/admins/stats",
  authenticate(),
  authorize("superAdmin"),
  asyncHandler(authController.adminStats)
);

router.post(
  "/admins",
  authenticate(),
  authorize("superAdmin"),
  validateRequest({ body: createAdminSchema }),
  asyncHandler(authController.createAdmin)
);

router.put(
  "/admins/:id",
  authenticate(),
  authorize("superAdmin"),
  validateRequest({ body: updateAdminSchema }),
  asyncHandler(authController.updateAdmin)
);

router.delete(
  "/admins/:id",
  authenticate(),
  authorize("superAdmin"),
  asyncHandler(authController.deleteAdmin)
);

export const authRoutes = router;

