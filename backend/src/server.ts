import http from "node:http";

import mongoose from "mongoose";
import cron from "node-cron";

import { env } from "./config/env";
import { connectDatabase } from "./lib/mongoose";
import {verifyDatabaseReadiness} from './lib/database-readiness';
import { authService } from "./modules/auth/auth.service";
import { createApp } from "./app";
import { migrateLegacyProductRecords } from "./modules/products/product.migration";
import { migrateSplitCollections } from "./modules/migrations/split-collections.migration";
import { migrateFixDisplayIndex } from "./modules/migrations/fix-display-index.migration";
import { migrateProductBarcodeUniqueIndex } from "./modules/migrations/product-barcode-unique-index.migration";
import { migrateBackfillPhoneDigits } from "./modules/migrations/backfill-phone-digits.migration";
import { migrateProductImagesToR2 } from "./modules/migrations/backfill-product-images-to-r2.migration";
import { subscriptionService } from "./modules/subscriptions/subscription.service";
import { paymentService } from "./modules/payments/payment.service";
import { telegramReportService } from "./services/telegram-report.service";
import { warmUpOcr } from "./utils/ocr";

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

async function bootstrap() {
  await connectDatabase();
  if (env.MIGRATION_ENABLED) {
    await migrateFixDisplayIndex();
    await migrateProductBarcodeUniqueIndex();
    await migrateBackfillPhoneDigits();
    await migrateSplitCollections();
    await migrateLegacyProductRecords();
    await migrateProductImagesToR2();
  }
  if(env.NODE_ENV==='production') await verifyDatabaseReadiness();

  // Real fix for a long-standing gap: subscription expiry used to only be
  // checked lazily (on a user's next login/me/refresh call), so a lapsed
  // paid account could keep working for an arbitrary amount of time if it
  // simply didn't hit one of those routes. Runs every hour; harmless to run
  // more often than subscriptions actually expire.
  cron.schedule("0 * * * *", () => {
    subscriptionService.refreshExpiredSubscriptions().catch((error) => {
      console.error("refreshExpiredSubscriptions cron failed", error);
    });
  });

  // Second layer of defense behind OCR auto-provisioning (see
  // payment.service.ts#attachReceipt): a "provisioned" payment nobody
  // confirmed within 48h has its tier taken back automatically, the same
  // way an admin's Reject would. OCR alone can't catch a forged screenshot
  // — this bounds how long a forged one can ride on a granted tier before a
  // human (or this cron) closes the window. Hourly, same cadence as the
  // subscription-expiry cron above.
  cron.schedule("0 * * * *", () => {
    paymentService
      .autoExpireProvisionedPayments()
      .then((expired) => {
        if (expired.length === 0) return;

        console.log(
          `[autoExpireProvisionedPayments] auto-rejected ${expired.length} unconfirmed payment(s): ` +
            expired.map((p) => `${p.paymentId} (user ${p.userId}, ${p.tier})`).join(", "),
        );

        // Best-effort — this is the same ops-monitoring channel product/
        // inventory events already report to (BOT_TOKEN/TELEGRAM_CHAT_ID),
        // not the separate hisvex-bot admin-approval chat (that bot owns
        // its own Telegram session and isn't reachable from here). Silence
        // here just means the log line above is the only record, not that
        // anything downstream failed.
        telegramReportService.dispatch({
          title: "To'lov(lar) avtomatik bekor qilindi (48 soat, admin tasdiqlamadi)",
          lines: expired.map(
            (p) => `Payment ${p.paymentId} | user ${p.userId} | ${p.tier} | ${p.amount} so'm`,
          ),
        });
      })
      .catch((error) => {
        console.error("autoExpireProvisionedPayments cron failed", error);
      });
  });

  // Pays the OCR worker's first-use cost (traineddata fetch, see ocr.ts) at
  // boot instead of on whichever admin's receipt upload happens to be first
  // after a cold start. Not awaited — a slow/unreachable fetch here must
  // never delay the health check or block startup; a receipt uploaded
  // before this resolves just falls through to the same lazy getWorker().
  warmUpOcr().catch((error) => {
    console.error("OCR worker warm-up failed (will retry lazily on first receipt upload):", error);
  });

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
