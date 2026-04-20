import { Router } from "express";

import { asyncHandler } from "../../utils/async-handler";
import { validateRequest } from "../../middlewares/validate.middleware";
import {
  createProductSchema,
  productIdentifierParamsSchema,
  productSearchQuerySchema,
  updateProductSchema
} from "./product.validation";
import { productController } from "./product.controller";

const router = Router();

router.get(
  "/",
  validateRequest({ query: productSearchQuerySchema }),
  asyncHandler(productController.list)
);

router.get(
  "/:id",
  validateRequest({ params: productIdentifierParamsSchema }),
  asyncHandler(productController.get)
);

router.post(
  "/",
  validateRequest({ body: createProductSchema }),
  asyncHandler(productController.create)
);

router.put(
  "/:id",
  validateRequest({
    params: productIdentifierParamsSchema,
    body: updateProductSchema
  }),
  asyncHandler(productController.update)
);

router.delete(
  "/:id",
  validateRequest({ params: productIdentifierParamsSchema }),
  asyncHandler(productController.remove)
);

export const productRoutes = router;
