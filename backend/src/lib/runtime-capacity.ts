import { availableParallelism, freemem } from "node:os";
import { env } from "../config/env";

export function poolBudget(workers: number, replicas = env.DEPLOYMENT_REPLICAS) {
  if (!Number.isInteger(workers) || workers < 1 || !Number.isInteger(replicas) || replicas < 1) throw Error("Invalid MongoDB worker/replica count");
  // Conservative topology-wide budget: every member can own a full pool,
  // plus two driver monitoring sockets per member. Other clients get reserve.
  const perPool = Math.floor((env.MONGO_CONNECTION_BUDGET - env.MONGO_CONNECTION_RESERVE) / (workers * replicas * env.MONGO_TOPOLOGY_MEMBERS)) - 2;
  if (perPool < 1) throw Error("MongoDB connection budget is too small for the configured worker/replica count");
  const maxPoolSize = Math.min(env.MONGO_MAX_POOL_SIZE, perPool);
  return { maxPoolSize, minPoolSize: Math.min(env.MONGO_MIN_POOL_SIZE, maxPoolSize), socketTimeoutMS: 45000, waitQueueTimeoutMS: 5000, maxConnecting: 2, maxIdleTimeMS: 60000, serverSelectionTimeoutMS: 5000 };
}

export function clusterWorkerCount() {
  const requested = env.WEB_CONCURRENCY === "auto" ? availableParallelism() : Number(env.WEB_CONCURRENCY);
  // A process needs a JS heap, native buffers, and a lazy export/OCR worker.
  const memoryBound = Math.max(1, Math.floor((typeof process.availableMemory === "function" ? process.availableMemory() : freemem()) / (640 * 1024 * 1024)));
  const budgetBound = Math.floor((env.MONGO_CONNECTION_BUDGET - env.MONGO_CONNECTION_RESERVE) / (env.DEPLOYMENT_REPLICAS * env.MONGO_TOPOLOGY_MEMBERS * (env.MONGO_MIN_POOL_SIZE + 2)));
  if (budgetBound < 1) throw Error("MongoDB budget cannot accommodate the minimum pool");
  return Math.max(1, Math.min(requested, availableParallelism(), memoryBound, budgetBound));
}
