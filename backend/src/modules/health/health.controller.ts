import mongoose from "mongoose";

import { env } from "../../config/env";

export const healthController = {
  get() {
    const dbState = mongoose.connection.readyState;
    const dbStatus = dbState === 1 ? "connected" : dbState === 2 ? "connecting" : "disconnected";

    return {
      status: dbState === 1 ? "ok" : "degraded",
      service: "bar-backend",
      database: dbStatus,
      uptime: process.uptime(),
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString()
    };
  }
};
