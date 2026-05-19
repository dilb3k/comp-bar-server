import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { env } from "./config/env";
import { subscriptionRoutes } from "./modules/subscriptions/subscription.routes";
import { apiLimiter } from "./middlewares/rate-limit.middleware";
import { errorMiddleware } from "./middlewares/error.middleware";
import { notFoundMiddleware } from "./middlewares/not-found.middleware";
import { authRoutes } from "./modules/auth/auth.routes";
import { authenticate } from "./modules/auth/auth.middleware";
import { statsRoutes } from "./modules/stats/stats.routes";
import { healthRoutes } from "./modules/health/health.routes";
import { debtorRoutes } from "./modules/debtors/debtor.routes";
import { inventoryRoutes } from "./modules/inventory/inventory.routes";
import { productRoutes } from "./modules/products/product.routes";
import { productImageRoutes } from "./modules/products/product-image.routes";
import { snapshotRoutes } from "./modules/snapshots/snapshot.routes";
import { syncRoutes } from "./modules/sync/sync.routes";

const allowedOrigins =
  env.CLIENT_URL === "*"
    ? true
    : env.CLIENT_URL.split(",").map((origin) => origin.trim()).filter(Boolean);

export function createApp() {
  const app = express();

  app.set("trust proxy", true);

  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true
    })
  );
  app.use(helmet());
  app.use(express.json({ limit: "20mb" }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
  app.use("/api", apiLimiter);

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
  app.use("/api/auth", authRoutes);
  app.use("/api/products", productImageRoutes);
  app.use("/api/products", authenticate, productRoutes);
  app.use("/api/debtors", authenticate, debtorRoutes);
  app.use("/api/inventory", authenticate, inventoryRoutes);
  app.use("/api/snapshots", authenticate, snapshotRoutes);
  app.use("/api/sync", authenticate, syncRoutes);
  app.use("/api/subscriptions", authenticate, subscriptionRoutes);
  app.use("/api/stats", authenticate, statsRoutes);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
