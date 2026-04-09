import { Router } from "express";
import { syncController } from "../controllers/sync.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { syncPullQuerySchema, syncPushSchema } from "../validators/sync.validator";

const syncRouter = Router();

syncRouter.use(requireAuth);

syncRouter.post("/", validate({ body: syncPushSchema }), syncController.push);
syncRouter.get("/", validate({ query: syncPullQuerySchema }), syncController.pull);

export { syncRouter };
