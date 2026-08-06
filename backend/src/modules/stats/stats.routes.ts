import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate, authorize } from "../auth/auth.middleware";
import { statsController } from "./stats.controller";

const router = Router();

router.get(
  "/",
  authenticate(),
  authorize("superAdmin"),
  asyncHandler(statsController.get),
);

export const statsRoutes = router;
