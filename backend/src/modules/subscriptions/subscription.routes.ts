import { Router } from "express";

import { asyncHandler } from "../../utils/async-handler";
import { validateRequest } from "../../middlewares/validate.middleware";
import { authenticate, authorize } from "../auth/auth.middleware";
import { subscriptionController } from "./subscription.controller";
import { activateSubscriptionSchema } from "./subscription.validation";

const router = Router();

router.post(
  "/activate",
  authenticate(),
  authorize("superAdmin"),
  validateRequest({ body: activateSubscriptionSchema }),
  asyncHandler(subscriptionController.activate)
);

router.post(
  "/deactivate/:userId",
  authenticate(),
  authorize("superAdmin"),
  asyncHandler(subscriptionController.deactivate)
);

router.get(
  "/",
  authenticate(),
  authorize("superAdmin"),
  asyncHandler(subscriptionController.list)
);

export const subscriptionRoutes = router;
