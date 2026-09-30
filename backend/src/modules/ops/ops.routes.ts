import { Router } from "express";

import { asyncHandler } from "../../utils/async-handler";
import { validateRequest } from "../../middlewares/validate.middleware";
import { reportFailoverSchema } from "./ops.validation";
import { opsController } from "./ops.controller";

const router = Router();

router.post(
  "/failover",
  validateRequest({ body: reportFailoverSchema }),
  asyncHandler(opsController.reportFailover),
);

export const opsRoutes = router;
