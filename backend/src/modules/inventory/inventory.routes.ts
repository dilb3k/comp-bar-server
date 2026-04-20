import { Router } from "express";

import { validateRequest } from "../../middlewares/validate.middleware";
import { asyncHandler } from "../../utils/async-handler";
import { inventoryController } from "./inventory.controller";
import {
  inventoryBulkCurrentSchema,
  inventoryDateQuerySchema,
  inventoryRangeQuerySchema,
  inventoryStartDaySchema
} from "./inventory.validation";

const router = Router();

router.get(
  "/",
  validateRequest({ query: inventoryDateQuerySchema }),
  asyncHandler(inventoryController.getByDate)
);

router.get(
  "/range",
  validateRequest({ query: inventoryRangeQuerySchema }),
  asyncHandler(inventoryController.getRange)
);

router.post(
  "/start-day",
  validateRequest({ body: inventoryStartDaySchema }),
  asyncHandler(inventoryController.startDay)
);

router.put(
  "/bulk-current",
  validateRequest({ body: inventoryBulkCurrentSchema }),
  asyncHandler(inventoryController.bulkCurrent)
);

export const inventoryRoutes = router;
