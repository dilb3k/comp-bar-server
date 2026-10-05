import mongoose from "mongoose";

import { poolBudget } from "./runtime-capacity";
import { env } from "../config/env";
import { alertService } from "../services/alert.service";

let connecting: Promise<void> | null = null;
let listenersInstalled = false;
let closing = false;
export function connectDatabase(): Promise<void> {
  if (!connecting) connecting = openDatabase().catch(async error => { try { await mongoose.disconnect(); } finally { connecting = null; } throw error; });
  return connecting;
}

async function openDatabase() {
  closing = false;
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
      ...poolBudget(Number(process.env.CLUSTER_WORKERS || 1)),
      bufferCommands: false,
    });
    const hello = await mongoose.connection.db!.admin().command({hello:1});
    if (!hello.setName && hello.msg !== "isdbgrid") {
      await mongoose.disconnect();
      throw new Error("Financial writes require a MongoDB replica set or sharded cluster");
    }
    console.log("Connected to primary MongoDB");

    if (!listenersInstalled) {
      listenersInstalled = true;
      mongoose.connection.on("disconnected", () => {
        if (closing) return;
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
    }
    return;
  } catch (err) {
    console.error("MongoDB unavailable; refusing to switch to another dataset");
    throw err;
  }
}

export async function disconnectDatabase() {
  closing = true;
  await mongoose.disconnect();
  connecting = null;
}
