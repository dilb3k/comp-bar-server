import mongoose from "mongoose";

import { env } from "../config/env";
import { alertService } from "../services/alert.service";

export async function connectDatabase() {
  mongoose.set("strictQuery", true);

  const primaryUrl = env.MONGODB_URL;
  // Application failover must keep the same receipt/stock database. The MongoDB
  // replica-set driver handles primary election; switching datasets is unsafe.
  if (env.MONGODB_FALLBACK_URL && env.MONGODB_FALLBACK_URL !== primaryUrl) {
    throw new Error("Independent MONGODB_FALLBACK_URL is unsupported: configure both API instances with the same replica-set URI");
  }

  try {
    await mongoose.connect(primaryUrl, {
      autoIndex: env.NODE_ENV !== 'production',
      // Several endpoints (sales, startDay, bulkUpdateCurrent, product
      // create/update, sync) hold a session/transaction open across multiple
      // sequential round trips each. This is an initial pool budget, not
      // proof of capacity. Benchmark the deployed tier and sum connections
      // across every API instance before increasing it.
      maxPoolSize: 50,
      // Keeps this many connections warm even when idle, so the first
      // requests after a quiet period (this app's usual traffic pattern —
      // shops open, ring up sales in bursts, go quiet) don't each pay a
      // fresh TCP+TLS handshake to Atlas before their query even starts.
      minPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    });
    const hello = await mongoose.connection.db!.admin().command({hello:1});
    if (!hello.setName && hello.msg !== "isdbgrid") {
      await mongoose.disconnect();
      throw new Error("Financial writes require a MongoDB replica set or sharded cluster");
    }
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
    console.error("MongoDB unavailable; refusing to switch to another dataset");
    throw err;
  }
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
