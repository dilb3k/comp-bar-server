import { Router } from "express";

import { asyncHandler } from "../../utils/async-handler";
import { validateRequest } from "../../middlewares/validate.middleware";
import { authController } from "./auth.controller";
import { authenticate, authorize } from "./auth.middleware";
import { createAdminSchema, loginSchema } from "./auth.validation";

const router = Router();

router.post(
  "/login",
  validateRequest({ body: loginSchema }),
  asyncHandler(authController.login)
);

router.get(
  "/me",
  authenticate,
  asyncHandler(authController.me)
);

router.get(
  "/admins",
  authenticate,
  authorize("superAdmin"),
  asyncHandler(authController.listAdmins)
);

router.post(
  "/admins",
  authenticate,
  authorize("superAdmin"),
  validateRequest({ body: createAdminSchema }),
  asyncHandler(authController.createAdmin)
);

export const authRoutes = router;
