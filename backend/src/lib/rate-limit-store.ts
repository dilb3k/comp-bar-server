import cluster from "node:cluster";
import type { Store, Options, IncrementResponse } from "express-rate-limit";
import { AppError } from "../utils/app-error";

type Counter = { totalHits: number; reset: number };
type Command = { type: "rate-limit"; id: number; op: "increment" | "decrement" | "reset"; key: string; windowMs: number };
export class WindowBuckets {
  private entries = new Map<string, Counter>();
  private sweep = this.entries.entries();
  constructor(private capacity = 200000) {}
  apply(op: Command["op"], key: string, windowMs: number, now = Date.now()) {
    // Incremental cleanup bounds synchronous work even under an IP spray.
    for (let i = 0; i < 8; i++) {
      const next = this.sweep.next();
      if (next.done) { this.sweep = this.entries.entries(); break; }
      if (next.value[1].reset <= now) this.entries.delete(next.value[0]);
    }
    let entry = this.entries.get(key);
    if (entry && entry.reset <= now) { this.entries.delete(key); entry = undefined; }
    if (op === "reset") { this.entries.delete(key); return { totalHits: 0, reset: now + windowMs }; }
    if (op === "decrement") { if (entry) entry.totalHits = Math.max(0, entry.totalHits - 1); return entry ?? { totalHits: 0, reset: now + windowMs }; }
    if (!entry) {
      // Never evict a live brute-force counter to admit a new key.
      if (this.entries.size >= this.capacity) throw new AppError("Too many requests. Please try again later.", 503);
      entry = { totalHits: 0, reset: now + windowMs }; this.entries.set(key, entry);
    }
    entry.totalHits++;
    return { ...entry };
  }
  get size() { return this.entries.size; }
}
const buckets = new WindowBuckets();
let sequence = 0;
const pending = new Map<number, { resolve: (value: Counter) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
if (cluster.isWorker) {
  process.on("message", (message: any) => {
    if (message?.type !== "rate-limit-result") return;
    const task = pending.get(message.id); if (!task) return;
    pending.delete(message.id); clearTimeout(task.timer);
    if (message.error) task.reject(new AppError("Too many requests. Please try again later.", 503));
    else task.resolve(message.value);
  });
  process.on("disconnect", () => {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new AppError("Rate limiter unavailable", 503)); }
    pending.clear();
  });
}

export function attachRateLimitBroker(worker: import("node:cluster").Worker) {
  worker.on("message", (message: Command) => {
    if (message?.type !== "rate-limit") return;
    let response: Record<string, unknown>;
    try { response = { value: buckets.apply(message.op, message.key, message.windowMs) }; }
    catch { response = { error: true }; }
    if (worker.isConnected()) worker.send({ type: "rate-limit-result", id: message.id, ...response }, () => {});
  });
}

export class ClusterRateStore implements Store {
  localKeys = false;
  private windowMs = 60000;
  constructor(public prefix: string) {}
  init(options: Options) { this.windowMs = options.windowMs; }
  private async command(op: Command["op"], key: string): Promise<Counter> {
    key = this.prefix + ":" + key;
    if (!cluster.isWorker) return buckets.apply(op, key, this.windowMs);
    if (!process.connected || pending.size >= 2048) throw new AppError("Rate limiter unavailable", 503);
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const fail = () => { const task = pending.get(id); if (!task) return; clearTimeout(task.timer); pending.delete(id); reject(new AppError("Rate limiter unavailable", 503)); };
      const timer = setTimeout(fail, 5000); timer.unref();
      pending.set(id, { resolve, reject, timer });
      process.send!({ type: "rate-limit", id, op, key, windowMs: this.windowMs }, error => { if (error) fail(); });
    });
  }
  async increment(key: string): Promise<IncrementResponse> { const value = await this.command("increment", key); return { totalHits: value.totalHits, resetTime: new Date(value.reset) }; }
  async decrement(key: string) { await this.command("decrement", key); }
  async resetKey(key: string) { await this.command("reset", key); }
}
