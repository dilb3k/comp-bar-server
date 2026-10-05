import { AppError } from "../utils/app-error";

// Reject excess expensive work instead of an unbounded Mongo wait queue.
export class WorkGate {
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(private concurrency: number, private maxQueue: number, private waitMs = 5000) {}
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.maxQueue) throw new AppError("Report service busy; retry later", 503);
      await new Promise<void>((resolve, reject) => {
        const enter = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => { this.waiting = this.waiting.filter(item => item !== enter); reject(new AppError("Report service busy; retry later", 503)); }, this.waitMs);
        this.waiting.push(enter);
      });
    } else this.active++;
    try { return await work(); }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  }
}
export const analyticsGate = new WorkGate(4, 128);
export const exportGate = new WorkGate(1, 4);
