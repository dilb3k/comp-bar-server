import type { Response } from "express";

function safeStringify(value: any): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === "object") {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
    }
    return val;
  });
}

export function sendSuccess<T>(res: Response, data: T, statusCode = 200) {
  const body = { success: true, data };
  const json = safeStringify(body);
  res.setHeader("Content-Type", "application/json");
  return res.status(statusCode).send(json);
}
