import http from "node:http";

import mongoose from "mongoose";

import { env } from "./config/env";
import { connectDatabase } from "./lib/mongoose";
import { authService } from "./modules/auth/auth.service";
import { createApp } from "./app";
import { migrateLegacyProductRecords } from "./modules/products/product.migration";
import { migrateSplitCollections } from "./modules/migrations/split-collections.migration";
import { migrateFixDisplayIndex } from "./modules/migrations/fix-display-index.migration";
import { migrateProductBarcodeUniqueIndex } from "./modules/migrations/product-barcode-unique-index.migration";

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

async function bootstrap() {
  await connectDatabase();
  const superAdmin = await authService.findSuperAdmin();

  if (superAdmin?._id) {
    await authService.migrateLegacyOwnership(superAdmin._id.toString());
  }

  // Always heal the stale unique displayIndex index — idempotent, and it
  // prevents E11000 errors on product create/sync/reorder.
  await migrateFixDisplayIndex();

  // Always attempt to roll the products.idx_barcodes index over to unique
  // (idempotent, safe — detects pre-existing duplicate barcodes and skips
  // without touching data if any are found; see migration file for details).
  await migrateProductBarcodeUniqueIndex();

  if (env.MIGRATION_ENABLED) {
    await migrateSplitCollections();
    await migrateLegacyProductRecords();
  }

  const app = createApp();

  const server = http.createServer(app);

  server.listen(env.PORT, () => {
    console.log(`Backend listening on http://localhost:${env.PORT}`);
  });

  function gracefulShutdown(signal: string) {
    console.log(`Received ${signal}, shutting down gracefully...`);
    server.close(() => {
      console.log("HTTP server closed");
      mongoose.disconnect().then(() => {
        console.log("MongoDB disconnected");
        process.exit(0);
      });
    });
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

void bootstrap().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
