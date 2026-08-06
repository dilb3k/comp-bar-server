import { Router } from "express";

import { asyncHandler } from "../../utils/async-handler";
import { validateRequest } from "../../middlewares/validate.middleware";
import { authorize } from "../auth/auth.middleware";
import { subscriptionController } from "./subscription.controller";
import { activateSubscriptionSchema } from "./subscription.validation";

// authenticate() is already applied when this router is mounted in app.ts
// (`app.use("/api/subscriptions", authenticate(), subscriptionRoutes)`),
// matching how every other protected route group in app.ts is structured.
// Only the role check (authorize) belongs here.
const router = Router();

router.post(
  "/activate",
  authorize("superAdmin"),
  validateRequest({ body: activateSubscriptionSchema }),
  asyncHandler(subscriptionController.activate)
);

router.post(
  "/deactivate/:userId",
  authorize("superAdmin"),
  asyncHandler(subscriptionController.deactivate)
);

router.get(
  "/",
  authorize("superAdmin"),
  asyncHandler(subscriptionController.list)
);

export const subscriptionRoutes = router;
