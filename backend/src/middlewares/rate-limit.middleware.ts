import { env } from "../config/env";
import { ClusterRateStore } from "../lib/rate-limit-store";
import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";
import { detectLanguage, translateMessage } from "../utils/i18n";

const localizedLimit = (message: string) => (req: Request, res: Response) => {
  res.vary("Accept-Language");
  res.status(429).json({
    success: false,
    error: { message: translateMessage(message, detectLanguage(req.headers["accept-language"])), details: null },
  });
};

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  store: new ClusterRateStore("auth"),
  handler: localizedLimit("Too many login attempts. Please try again after 15 minutes."),
  standardHeaders: true,
  legacyHeaders: false,
});

const policy = (name: string, limit: number) => rateLimit({
  windowMs: 60000, limit, store: new ClusterRateStore(name),
  handler: localizedLimit("Too many requests. Please try again later."),
  standardHeaders: true, legacyHeaders: false,
});
const readLimiter = policy("read", env.API_READ_LIMIT);
const writeLimiter = policy("write", env.API_WRITE_LIMIT);
export const paymentLimiter = policy("payment", 120);
export const apiLimiter: RequestHandler = (req, res, next) => {
  // Health probes stay available during overload. Auth has its own strict
  // limiter and must not consume the shop's read/write quota.
  if (req.path === "/health" || req.path === "/health/") return next();
  if (req.path.startsWith("/payments/") || (req.path.startsWith("/bot/") && !["GET", "HEAD"].includes(req.method))) return paymentLimiter(req, res, next);
  return (["GET", "HEAD", "OPTIONS"].includes(req.method) ? readLimiter : writeLimiter)(req, res, next);
};

export const imageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 600,
  store: new ClusterRateStore("image"),
  handler: localizedLimit("Too many image requests. Please try again later."),
  standardHeaders: true,
  legacyHeaders: false,
});
