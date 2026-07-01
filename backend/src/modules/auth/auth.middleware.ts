import type { NextFunction, Request, Response } from "express";

import { AppError } from "../../utils/app-error";
import type { UserRole } from "./auth.types";
import { verifyAccessToken } from "./auth.utils";
import { authRepository } from "./auth.repository";

function extractBearerToken(req: Request) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = extractBearerToken(req);

  if (!token) {
    return next(new AppError("Authorization token is required", 401));
  }

  try {
    const payload = verifyAccessToken(token);

    const user = await authRepository.findById(payload.userId);
    if (!user || !user.isActive) {
      return next(new AppError("User account is deactivated", 401));
    }

    const isSuperAdmin = payload.role === "superAdmin";
    req.auth = {
      userId: payload.userId,
      username: payload.username,
      phone_number: payload.phone_number,
      role: payload.role,
      isPayed: payload.isPayed ?? isSuperAdmin,
      tier: payload.tier ?? (isSuperAdmin ? "pro" : "tekin"),
      subscriptionEndDate: payload.subscriptionEndDate ?? null,
      businessDayStartHour: payload.businessDayStartHour,
      pendingBusinessDayStartHour: payload.pendingBusinessDayStartHour,
      businessDayEffectiveFrom: payload.businessDayEffectiveFrom
    };
    return next();
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }
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

  if (req.auth.tier !== "tekin") {
    return next();
  }

  return next(new AppError("Payment required. Please contact admin to activate premium features.", 402));
}
