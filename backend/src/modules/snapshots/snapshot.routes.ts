import { Router } from "express";

import { validateRequest } from "../../middlewares/validate.middleware";
import { asyncHandler } from "../../utils/async-handler";
import { snapshotController } from "./snapshot.controller";
import {
  snapshotDateQuerySchema,
  snapshotRangeQuerySchema,
  upsertSnapshotSchema
} from "./snapshot.validation";

const router = Router();

router.get(
  "/daily",
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
  validateRequest({ query: snapshotRangeQuerySchema }),
  asyncHandler(snapshotController.getRange)
);

export const snapshotRoutes = router;
