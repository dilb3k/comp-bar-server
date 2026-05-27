import { Router } from "express";

import { validateRequest } from "../../middlewares/validate.middleware";
import { asyncHandler } from "../../utils/async-handler";
import { inventoryController } from "./inventory.controller";
import {
  inventoryBulkCurrentSchema,
  inventoryDateQuerySchema,
  inventoryRangeQuerySchema,
  inventorySalesSchema,
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

router.get(
  "/dashboard",
  asyncHandler(inventoryController.dashboard)
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

router.post(
  "/sales",
  validateRequest({ body: inventorySalesSchema }),
  asyncHandler(inventoryController.sales)
);

export const inventoryRoutes = router;
