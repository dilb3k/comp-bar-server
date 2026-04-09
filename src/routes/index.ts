import { Router } from "express";
import { authRouter } from "./auth.routes";
import { productRouter } from "./product.routes";
import { statsRouter } from "./stats.routes";
import { syncRouter } from "./sync.routes";

const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Service is healthy"
  });
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/products", productRouter);
apiRouter.use("/sync", syncRouter);
apiRouter.use("/stats", statsRouter);

export { apiRouter };
