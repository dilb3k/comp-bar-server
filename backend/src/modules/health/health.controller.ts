import mongoose from "mongoose";

import { env } from "../../config/env";

export const healthController = {
  get() {
    const dbState = mongoose.connection.readyState;
    const dbStatus = dbState === 1 ? "connected" : dbState === 2 ? "connecting" : "disconnected";

    return {
      status: dbState === 1 ? "ok" : "degraded",
      service: "bar-backend",
      apiRelease: "procurement-analytics-2026-10-03",
      revision: [process.env.RENDER_GIT_COMMIT, process.env.RAILWAY_GIT_COMMIT_SHA]
        .find((value) => /^[a-f0-9]{40}$/i.test(value ?? "")) ?? null,
      database: dbStatus,
      uptime: process.uptime(),
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString()
    };
  }
};
