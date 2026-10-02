import { Router } from "express";

import { env } from "../../config/env";
import { asyncHandler } from "../../utils/async-handler";
import { validateRequest } from "../../middlewares/validate.middleware";
import { authLimiter } from "../../middlewares/rate-limit.middleware";
import { authController } from "./auth.controller";
import { authenticate, authorize } from "./auth.middleware";
import { createAdminSchema, loginSchema, loginWithPhoneSchema, refreshSchema, registerSchema, updateAdminSchema, updateMeSchema, verifySessionChallengeSchema } from "./auth.validation";

const router = Router();

// Previously the ALLOW_PUBLIC_REGISTER check lived only inside
// auth.service.register — the route was always reachable, and a disabled
// deployment still paid for a DB round-trip (hasSuperAdmin lookup) plus the
// authLimiter bucket per request just to get a 403. With the flag now
// defaulting to false and hard-required false in production (see
// config/env.ts), the route itself is unregistered instead: a disabled
// deployment gets a plain 404, and the bootstrap superAdmin is created by
// inserting directly into MongoDB (see README's "Ishga tushirish" — this was
// already the documented practice for superAdmin, never this route).
if (env.ALLOW_PUBLIC_REGISTER) {
  router.post(
    "/register",
    authLimiter,
    validateRequest({ body: registerSchema }),
    asyncHandler(authController.register)
  );
}

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


