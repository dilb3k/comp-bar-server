import { applyInventoryOperation } from "./operation.service";
import { inventoryOperationSchema } from "./inventory.validation";
import { sendSuccess } from "../../utils/response";
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
router.post("/operations", validateRequest({ body: inventoryOperationSchema }), asyncHandler(async (req, res) => {
  const result = await applyInventoryOperation(req.auth!, req.body);
  return sendSuccess(res, result.data, result.status);
}));

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
