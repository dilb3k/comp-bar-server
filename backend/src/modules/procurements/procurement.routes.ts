import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validateRequest } from "../../middlewares/validate.middleware";
import {
  listProcurementsQuerySchema,
  submitProcurementSchema,
  procurementAnalyticsQuerySchema,
  procurementIdentifierSchema,
} from "./procurement.validation";
import { procurementController } from "./procurement.controller";

const router = Router();
router.get(
  "/analytics",
  validateRequest({ query: procurementAnalyticsQuerySchema }),
  asyncHandler(procurementController.analytics),
);
router.get(
  "/export",
  validateRequest({ query: procurementAnalyticsQuerySchema }),
  asyncHandler(procurementController.export),
);
router.get("/summary", asyncHandler(procurementController.summary));
router.get(
  "/:id",
  validateRequest({ params: procurementIdentifierSchema }),
  asyncHandler(procurementController.detail),
);

router.get(
  "/",
  validateRequest({ query: listProcurementsQuerySchema }),
  asyncHandler(procurementController.list),
);

router.post(
  "/",
  validateRequest({ body: submitProcurementSchema }),
  asyncHandler(procurementController.submit),
);

export const procurementRoutes = router;
