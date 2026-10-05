import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { AppError } from "../utils/app-error";

type Output = { mime: string; body: Buffer };
type Task = { data: unknown; format: string; resolve: (value: Output) => void; reject: (error: Error) => void };
let worker: Worker | undefined;
let active: Task | undefined;
const queue: Task[] = [];
let deadline: NodeJS.Timeout | undefined;
let idle: NodeJS.Timeout | undefined;
let stopping = false;

function drain() {
  if (active || stopping) return;
  const task = queue.shift();
  if (!task) {
    idle = setTimeout(() => { const previous = worker; worker = undefined; void previous?.terminate(); }, 30000);
    idle.unref();
    return;
  }
  clearTimeout(idle);
  if (!worker) {
    const instance = worker = new Worker(join(__dirname, "../workers/report.worker.js"), { resourceLimits: { maxOldGenerationSizeMb: 128 } });
    instance.on("message", message => {
      if (worker !== instance || !active) return;
      clearTimeout(deadline);
      const completed = active; active = undefined;
      if (message.error) completed.reject(new AppError("Report generation failed", 503));
      else completed.resolve({ mime: message.mime, body: Buffer.from(message.body) });
      drain();
    });
    const failed = () => {
      if (worker !== instance) return;
      worker = undefined; clearTimeout(deadline);
      active?.reject(new AppError("Report generation failed", 503)); active = undefined;
      void instance.terminate(); drain();
    };
    instance.on("error", failed);
    instance.on("exit", failed);
  }
  active = task;
  deadline = setTimeout(() => {
    const previous = worker; worker = undefined;
    active?.reject(new AppError("Report generation timed out", 503)); active = undefined;
    void previous?.terminate(); drain();
  }, 60000);
  try { worker.postMessage({ data: task.data, format: task.format }); }
  catch {
    clearTimeout(deadline); active = undefined;
    task.reject(new AppError("Report generation failed", 503)); drain();
  }
}

export function exportReport(data: unknown, format: "csv" | "xlsx" | "pdf"): Promise<Output> {
  if (stopping || queue.length >= 4) return Promise.reject(new AppError("Report service busy; retry later", 503));
  return new Promise((resolve, reject) => { queue.push({ data, format, resolve, reject }); drain(); });
}

export async function closeReportWorker() {
  stopping = true; clearTimeout(idle); clearTimeout(deadline);
  const error = new AppError("Server shutting down", 503);
  active?.reject(error); active = undefined;
  for (const task of queue.splice(0)) task.reject(error);
  const previous = worker; worker = undefined;
  await previous?.terminate();
}
