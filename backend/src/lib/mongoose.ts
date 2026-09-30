import mongoose from "mongoose";

import { env } from "../config/env";
import { alertService } from "../services/alert.service";

export async function connectDatabase() {
  mongoose.set("strictQuery", true);

  const primaryUrl = env.MONGODB_URL;
  const fallbackUrl = env.MONGODB_FALLBACK_URL;

  let lastError: unknown;

  try {
    await mongoose.connect(primaryUrl, {
      // Several endpoints (sales, startDay, bulkUpdateCurrent, product
      // create/update, sync) hold a session/transaction open across multiple
      // sequential round trips each. Sized for ~1000 concurrent shop-owner
      // requests without turning MongoDB Atlas's own per-tier connection
      // ceiling into the bottleneck instead — raise further only after
      // confirming Atlas's own plan allows more (a shared/free tier caps
      // total connections well below what a busy paid tier allows).
      maxPoolSize: 50,
      // Keeps this many connections warm even when idle, so the first
      // requests after a quiet period (this app's usual traffic pattern —
      // shops open, ring up sales in bursts, go quiet) don't each pay a
      // fresh TCP+TLS handshake to Atlas before their query even starts.
      minPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    });
    console.log("Connected to primary MongoDB");

    mongoose.connection.on("disconnected", () => {
      console.warn("MongoDB disconnected");
      alertService.reportDbError("Ulanish uzildi (disconnected) — qayta ulanishga harakat qilinmoqda.");
    });
    mongoose.connection.on("error", (err) => {
      console.error("MongoDB connection error:", err.message);
      alertService.reportDbError(err.message);
    });
    mongoose.connection.on("reconnected", () => {
      console.log("MongoDB reconnected");
    });

    return;
  } catch (err) {
    console.warn("Primary MongoDB connection failed, trying fallback...", (err as Error).message);
    lastError = err;
  }

  if (fallbackUrl) {
    try {
      await mongoose.connect(fallbackUrl);
      console.log("Connected to fallback MongoDB");
      return;
    } catch (err) {
      console.error("Fallback MongoDB connection also failed:", (err as Error).message);
      lastError = err;
    }
  }

  throw lastError;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
