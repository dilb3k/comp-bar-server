import mongoose from "mongoose";

export const healthController = {
  get() {
    return {
      status: "ok",
      database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      timestamp: new Date().toISOString()
    };
  }
};
