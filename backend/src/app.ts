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
import { metaRoutes } from "./modules/meta/meta.routes";
import { debtorRoutes } from "./modules/debtors/debtor.routes";
import { inventoryRoutes } from "./modules/inventory/inventory.routes";
import { inventoryPreviewRoutes } from "./modules/inventory/inventory-preview.routes";
import { productRoutes } from "./modules/products/product.routes";
import { productImageRoutes } from "./modules/products/product-image.routes";
import { snapshotRoutes } from "./modules/snapshots/snapshot.routes";
import { syncRoutes } from "./modules/sync/sync.routes";
import { botRoutes, clickWebhookRoutes } from "./modules/payments";
import { opsRoutes } from "./modules/ops";

// A literal http://localhost:PORT origin can only be sent by a browser
// actually talking to a server on that machine's own loopback interface — a
// remote attacker's page cannot make a victim's browser forge it (the
// browser fills in the real Origin, unspoofable from page JS). Safe to allow
// in production too: it only ever matches someone's own local dev server
// (Vite/Next/Expo) hitting the live API while developing against it, never a
// request that actually originated from the internet.
const LOCALHOST_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  // Expo's web preview (`expo start --web`) serves from 8081 — missing here
  // meant every authenticated call (Authorization header triggers a CORS
  // preflight) failed cross-origin while testing media-project-mobile in a
  // browser, even though the same calls work fine from the native app
  // (CORS is a browser-only restriction, native fetch ignores it).
  "http://localhost:8081",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8081",
];
// Unlike a localhost origin, "null" IS trivially forgeable remotely (any
// sandboxed iframe or data: URI gets it, from any site) — it must never be
// in the production whitelist, dev convenience or not.
const SPOOFABLE_DEV_ORIGINS = ["null"];
const DEFAULT_PRODUCTION_ORIGINS = ["https://hisvex-web.vercel.app"];

function resolveAllowedOrigins(clientUrl: string, nodeEnv: string): string[] | boolean {
  const explicit = clientUrl
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .filter((origin) => origin !== "*");

  if (nodeEnv !== "production") {
    return explicit.length > 0
      ? [...new Set([...explicit, ...LOCALHOST_ORIGINS, ...SPOOFABLE_DEV_ORIGINS])]
      : true;
  }

  const origins = explicit.length > 0 ? explicit : DEFAULT_PRODUCTION_ORIGINS;
  if (explicit.length === 0) {
    console.warn(
      `[security] CLIENT_URL is "*" or unset in production. CORS restricted to: ${origins.join(", ")}. Set CLIENT_URL on the host to override.`
    );
  }
  return [...new Set([...origins, ...LOCALHOST_ORIGINS])];
}

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  const origins = resolveAllowedOrigins(env.CLIENT_URL, env.NODE_ENV);
  const corsOptions: Record<string, unknown> = {
    origin: origins,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With", "X-Account-ID", "Idempotency-Key", "X-Client-Protocol"],
    credentials: origins !== true,
    maxAge: 86400
  };
  app.use(cors(corsOptions));
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(express.json({ limit: "20mb" }));
  if(env.NODE_ENV!=="test") app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
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
  app.use("/api/meta", metaRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/products", productImageRoutes);
  app.use("/api/products", authenticate(), productRoutes);
  app.use("/api/debtors", authenticate(), debtorRoutes);
  app.use("/api/inventory", authenticate(), inventoryRoutes);
  app.use("/api/inventory-preview", authenticate({ allowStale: true }), inventoryPreviewRoutes);
  app.use("/api/snapshots", authenticate(), snapshotRoutes);
  app.use("/api/sync", authenticate(), syncRoutes);
  app.use("/api/subscriptions", authenticate(), subscriptionRoutes);
  app.use("/api/stats", authenticate(), statsRoutes);
  app.use("/api/ops", authenticate(), opsRoutes);

  // hisvex-bot integration: its own auth (shared secret, not a user JWT —
  // see bot-auth.middleware.ts), and Click's webhook (signature-verified
  // inside the controller, no auth header at all — Click calls it directly).
  app.use("/api/bot", botRoutes);
  app.use("/api/payments/click", express.urlencoded({extended:false,limit:"16kb"}), clickWebhookRoutes);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
