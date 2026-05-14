import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validateRequest } from "../../middlewares/validate.middleware";
import {
  createDebtorSchema,
  updateDebtorSchema,
  adjustDebtSchema,
  debtorIdentifierParamsSchema,
} from "./debtor.validation";
import { debtorController } from "./debtor.controller";

const router = Router();

router.get("/", asyncHandler(debtorController.list));

router.get(
  "/:id",
  validateRequest({ params: debtorIdentifierParamsSchema }),
  asyncHandler(debtorController.get)
);

router.post(
  "/",
  validateRequest({ body: createDebtorSchema }),
  asyncHandler(debtorController.create)
);

router.put(
  "/:id",
  validateRequest({
    params: debtorIdentifierParamsSchema,
    body: updateDebtorSchema,
  }),
  asyncHandler(debtorController.update)
);

router.post(
  "/:id/adjust",
  validateRequest({
    params: debtorIdentifierParamsSchema,
    body: adjustDebtSchema,
  }),
  asyncHandler(debtorController.adjust)
);

router.delete(
  "/:id",
  validateRequest({ params: debtorIdentifierParamsSchema }),
  asyncHandler(debtorController.remove)
);

export const debtorRoutes = router;
