import { Router } from "express";

import { validateRequest } from "../../middlewares/validate.middleware";
import { asyncHandler } from "../../utils/async-handler";
import { snapshotController } from "./snapshot.controller";
import { requirePayment } from "../auth/auth.middleware";
import {
  snapshotDateQuerySchema,
  snapshotRangeQuerySchema,
  upsertSnapshotSchema
} from "./snapshot.validation";

const router = Router();

router.get(
  "/daily",
  requirePayment,
  validateRequest({ query: snapshotDateQuerySchema }),
  asyncHandler(snapshotController.getDaily)
);

router.post(
  "/daily",
  validateRequest({ body: upsertSnapshotSchema }),
  asyncHandler(snapshotController.upsert)
);

router.get(
  "/range",
  requirePayment,
  validateRequest({ query: snapshotRangeQuerySchema }),
  asyncHandler(snapshotController.getRange)
);

export const snapshotRoutes = router;
