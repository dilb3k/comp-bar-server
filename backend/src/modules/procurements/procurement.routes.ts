import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validateRequest } from "../../middlewares/validate.middleware";
import { listProcurementsQuerySchema, submitProcurementSchema } from "./procurement.validation";
import { procurementController } from "./procurement.controller";

const router = Router();

router.get(
  "/",
  validateRequest({ query: listProcurementsQuerySchema }),
  asyncHandler(procurementController.list)
);

router.post(
  "/",
  validateRequest({ body: submitProcurementSchema }),
  asyncHandler(procurementController.submit)
);

export const procurementRoutes = router;
