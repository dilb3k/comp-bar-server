import { createHttpServer } from "./lib/http-server";


import cron from "node-cron";

import { env } from "./config/env";
import { connectDatabase, disconnectDatabase } from "./lib/mongoose";
import {verifyDatabaseReadiness} from './lib/database-readiness';
import { ensurePasswordResetStorage } from "./modules/auth/password-reset.model";
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
import { closeReportWorker } from "./lib/report-worker";

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

export async function prepareDatabase() {
  await connectDatabase();
  await ensurePasswordResetStorage();
  if (env.MIGRATION_ENABLED) {
    await migrateFixDisplayIndex();
    await migrateProductBarcodeUniqueIndex();
    await migrateBackfillPhoneDigits();
    await migrateSplitCollections();
    await migrateLegacyProductRecords();
    await migrateProductImagesToR2();
  }
  if(env.NODE_ENV==='production') await verifyDatabaseReadiness();

}

export async function bootstrap() {
  if (process.env.CLUSTER_BOOTSTRAPPED === "1") await connectDatabase();
  else await prepareDatabase();
  const jobs: ReturnType<typeof cron.schedule>[] = [];
  if (process.env.RUN_SCHEDULED_JOBS !== "false" && process.env.CLUSTER_SCHEDULER !== "0") {
  // Real fix for a long-standing gap: subscription expiry used to only be
  // checked lazily (on a user's next login/me/refresh call), so a lapsed
  // paid account could keep working for an arbitrary amount of time if it
  // simply didn't hit one of those routes. Runs every hour; harmless to run
  // more often than subscriptions actually expire.
  jobs.push(cron.schedule("0 * * * *", () => {
    subscriptionService.refreshExpiredSubscriptions().catch((error) => {
      console.error("refreshExpiredSubscriptions cron failed", error);
    });
  }));

  // Second layer of defense behind OCR auto-provisioning (see
  // payment.service.ts#attachReceipt): a "provisioned" payment nobody
  // confirmed within 48h has its tier taken back automatically, the same
  // way an admin's Reject would. OCR alone can't catch a forged screenshot
  // — this bounds how long a forged one can ride on a granted tier before a
  // human (or this cron) closes the window. Hourly, same cadence as the
  // subscription-expiry cron above.
  jobs.push(cron.schedule("0 * * * *", () => {
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
  }));
  }

  // OCR stays lazy: do not allocate/fetch a worker in every API process at boot.
  const app = createApp();

  const server = createHttpServer(app);

  server.listen({ port: env.PORT, backlog: 4096 }, () => {
    console.log(`Backend listening on http://localhost:${env.PORT}`);
  });

  let stopping = false;
  function gracefulShutdown(signal: string) {
    if (stopping) return;
    stopping = true;
    console.log(`Received ${signal}, draining HTTP requests...`);
    for (const job of jobs) job.stop();
    const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 25000);
    deadline.unref();
    server.close(async () => {
      try { await closeReportWorker(); await disconnectDatabase(); process.exit(0); }
      catch (error) { console.error("Shutdown failed", error); process.exit(1); }
    });
    server.closeIdleConnections();
  }
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("disconnect", () => gracefulShutdown("parent disconnect"));
  process.on("message", message => { if (message === "shutdown") gracefulShutdown("primary shutdown"); });
  return server;
}

if (require.main === module) void bootstrap().catch(error => {
  console.error("Failed to start server", error);
  process.exit(1);
});
