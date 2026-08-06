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

const LOCAL_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "null"
];
const DEFAULT_PRODUCTION_ORIGINS = ["https://hisvex-web.vercel.app"];

function resolveAllowedOrigins(clientUrl: string, nodeEnv: string): string[] | boolean {
  const explicit = clientUrl
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .filter((origin) => origin !== "*");

  if (nodeEnv !== "production") {
    return explicit.length > 0 ? [...new Set([...explicit, ...LOCAL_ORIGINS])] : true;
  }

  const origins = explicit.length > 0 ? explicit : DEFAULT_PRODUCTION_ORIGINS;
  if (explicit.length === 0) {
    console.warn(
      `[security] CLIENT_URL is "*" or unset in production. CORS restricted to: ${origins.join(", ")}. Set CLIENT_URL on the host to override.`
    );
  }
  return [...new Set([...origins, ...LOCAL_ORIGINS])];
}

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  const origins = resolveAllowedOrigins(env.CLIENT_URL, env.NODE_ENV);
  const corsOptions: Record<string, unknown> = {
    origin: origins,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With"],
    credentials: origins !== true,
    maxAge: 86400
  };
  app.use(cors(corsOptions));
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
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
  app.use("/api/products", authenticate(), productRoutes);
  app.use("/api/debtors", authenticate(), debtorRoutes);
  app.use("/api/inventory", authenticate(), inventoryRoutes);
  app.use("/api/snapshots", authenticate(), snapshotRoutes);
  app.use("/api/sync", authenticate(), syncRoutes);
  app.use("/api/subscriptions", authenticate(), subscriptionRoutes);
  app.use("/api/stats", authenticate(), statsRoutes);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
