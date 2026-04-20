import mongoose from "mongoose";

import { env } from "../config/env";

export async function connectDatabase() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGODB_URL);
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
