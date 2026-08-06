import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authorize } from "../auth/auth.middleware";
import { statsController } from "./stats.controller";

// authenticate() is already applied when this router is mounted in app.ts
// (`app.use("/api/stats", authenticate(), statsRoutes)`) — same redundant-auth
// issue identified for /api/subscriptions applies here too. Only the role
// check (authorize) belongs here.
const router = Router();

router.get(
  "/",
  authorize("superAdmin"),
  asyncHandler(statsController.get),
);

export const statsRoutes = router;
