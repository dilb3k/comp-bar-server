import { Router } from "express";

import { validateRequest } from "../../middlewares/validate.middleware";
import { asyncHandler } from "../../utils/async-handler";
import { syncPayloadSchema } from "./sync.validation";
import { syncController } from "./sync.controller";

const router = Router();

router.post(
  "/",
  validateRequest({ body: syncPayloadSchema }),
  asyncHandler(syncController.sync)
);

export const syncRoutes = router;
