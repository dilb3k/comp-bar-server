import { Router } from "express";
import { statsController } from "../controllers/stats.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { statsQuerySchema } from "../validators/stats.validator";

const statsRouter = Router();

statsRouter.use(requireAuth);

statsRouter.get("/summary", validate({ query: statsQuerySchema }), statsController.summary);
statsRouter.get("/products", validate({ query: statsQuerySchema }), statsController.products);

export { statsRouter };
