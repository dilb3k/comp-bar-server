import cluster from "node:cluster";
import { attachRateLimitBroker } from "./lib/rate-limit-store";
import { clusterWorkerCount, poolBudget } from "./lib/runtime-capacity";

async function main() {
  if (cluster.isWorker) {
    await (await import("./server")).bootstrap();
    return;
  }
  const count = clusterWorkerCount();
  console.log("API cluster", { workers: count, pool: poolBudget(count) });
  // No worker exists yet: migrations/index checks run once, and this
  // temporary client is closed before API pools are opened.
  await (await import("./server")).prepareDatabase();
  await (await import("./lib/mongoose")).disconnectDatabase();
  let stopping = false;
  const restarts: number[][] = Array.from({ length: count }, () => []);
  const timers = new Set<NodeJS.Timeout>();
  function stop(signal: string) {
    if (stopping) return;
    stopping = true;
    for (const timer of timers) clearTimeout(timer);
    for (const worker of Object.values(cluster.workers ?? {})) if (worker?.isConnected()) worker.send("shutdown");
    const deadline = setTimeout(() => {
      for (const worker of Object.values(cluster.workers ?? {})) worker?.kill("SIGKILL");
      process.exit(1);
    }, 30000);
    deadline.unref();
    console.log(`Cluster draining: ${signal}`);
  }
  function spawn(slot: number) {
    if (stopping) return;
    const worker = cluster.fork({ CLUSTER_WORKERS: String(count), CLUSTER_BOOTSTRAPPED: "1", CLUSTER_SCHEDULER: slot === 0 ? "1" : "0" });
    attachRateLimitBroker(worker);
    worker.on("listening", () => process.send?.({ type: "cluster-worker-ready", pid: worker.process.pid, slot }));
    worker.once("exit", (code, signal) => {
      if (stopping) return;
      const recent = restarts[slot] = restarts[slot].filter(time => Date.now() - time < 60000);
      recent.push(Date.now());
      console.error("API worker exited", { slot, code, signal });
      if (recent.length >= 5) { process.exitCode = 1; stop("repeated worker failures"); return; }
      const timer = setTimeout(() => { timers.delete(timer); spawn(slot); }, Math.min(1000 * 2 ** (recent.length - 1), 10000));
      timers.add(timer);
    });
  }
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  for (let slot = 0; slot < count; slot++) spawn(slot);
}
void main().catch(error => { console.error("Cluster startup failed", error); process.exit(1); });
