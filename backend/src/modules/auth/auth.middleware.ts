import type { NextFunction, Request, Response } from "express";

import { AppError } from "../../utils/app-error";
import type { UserRole } from "./auth.types";
import { verifyAccessToken } from "./auth.utils";

function extractBearerToken(req: Request) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = extractBearerToken(req);

  if (!token) {
    return next(new AppError("Authorization token is required", 401));
  }

  try {
    const payload = verifyAccessToken(token);
    req.auth = {
      userId: payload.userId,
      username: payload.username,
      role: payload.role,
      isPayed: payload.isPayed ?? (payload.role === "superAdmin")
    };
    return next();
  } catch {
    return next(new AppError("Invalid or expired token", 401));
  }
}

export function authorize(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new AppError("Unauthorized", 401));
    }

    if (!roles.includes(req.auth.role)) {
      return next(new AppError("Forbidden", 403));
    }

    return next();
  };
}

export function requirePayment(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) {
    return next(new AppError("Unauthorized", 401));
  }

  if (req.auth.role === "superAdmin") {
    return next();
  }

  if (!req.auth.isPayed) {
    return next(new AppError("Payment required. Please contact admin to activate premium features.", 402));
  }

  return next();
}
