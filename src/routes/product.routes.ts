import { Router } from "express";
import { productController } from "../controllers/product.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import {
  createProductSchema,
  listProductsQuerySchema,
  productParamsSchema,
  updateProductSchema
} from "../validators/product.validator";

const productRouter = Router();

productRouter.use(requireAuth);

productRouter.get("/", validate({ query: listProductsQuerySchema }), productController.list);
productRouter.post(
  "/",
  requireRole(["admin"]),
  validate({ body: createProductSchema }),
  productController.create
);
productRouter.patch(
  "/:id",
  requireRole(["admin"]),
  validate({ params: productParamsSchema, body: updateProductSchema }),
  productController.update
);

export { productRouter };
