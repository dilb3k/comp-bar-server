import mongoose from "mongoose";

import { env } from "../config/env";

export async function connectDatabase() {
  mongoose.set("strictQuery", true);

  const primaryUrl = env.MONGODB_URL;
  const fallbackUrl = env.MONGODB_FALLBACK_URL;

  let lastError: unknown;

  try {
    await mongoose.connect(primaryUrl);
    console.log("Connected to primary MongoDB");
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
