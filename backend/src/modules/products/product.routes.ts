import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validateRequest } from "../../middlewares/validate.middleware";
import { imageUpload } from "../../middlewares/upload.middleware";
import {
  createProductSchema,
  productIdentifierParamsSchema,
  productSearchQuerySchema,
  restockProductSchema,
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

router.patch(
  "/:id/restock",
  validateRequest({
    params: productIdentifierParamsSchema,
    body: restockProductSchema
  }),
  asyncHandler(productController.restock)
);

router.delete(
  "/:id",
  validateRequest({ params: productIdentifierParamsSchema }),
  asyncHandler(productController.remove)
);

// Preferred path for setting/replacing a product's photo: multipart file
// upload instead of embedding base64 in the JSON body above. Field name
// must be "image". Compresses to WebP and stores it in R2 — see
// product.service.ts#setImageFromUpload.
router.post(
  "/:id/image",
  validateRequest({ params: productIdentifierParamsSchema }),
  imageUpload.single("image"),
  asyncHandler(productController.uploadImage)
);

export const productRoutes = router;
