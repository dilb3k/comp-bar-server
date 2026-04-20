import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { env } from "./config/env";
import { errorMiddleware } from "./middlewares/error.middleware";
import { notFoundMiddleware } from "./middlewares/not-found.middleware";
import { healthRoutes } from "./modules/health/health.routes";
import { inventoryRoutes } from "./modules/inventory/inventory.routes";
import { productRoutes } from "./modules/products/product.routes";
import { snapshotRoutes } from "./modules/snapshots/snapshot.routes";
import { syncRoutes } from "./modules/sync/sync.routes";

const allowedOrigins =
  env.CLIENT_URL === "*"
    ? true
    : env.CLIENT_URL.split(",").map((origin) => origin.trim()).filter(Boolean);

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true
    })
  );
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  app.get("/", (_req, res) => {
    res.json({
      success: true,
      data: {
        service: "bar-backend",
        status: "running",
        docs: "/api/health"
      }
    });
  });

  app.use("/api/health", healthRoutes);
  app.use("/api/products", productRoutes);
  app.use("/api/inventory", inventoryRoutes);
  app.use("/api/snapshots", snapshotRoutes);
  app.use("/api/sync", syncRoutes);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
