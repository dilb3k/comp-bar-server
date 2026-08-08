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

export function authenticate(options?: { allowStale?: boolean }) {
  const allowStale = options?.allowStale ?? false;
  return async function authenticateMiddleware(req: Request, _res: Response, next: NextFunction) {
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

      // Single active session: the token's sessionId must match the account's
      // current session. Otherwise the session was replaced by another login.
      // allowStale is used by logout so a kicked device can still log itself out
      // without destroying the live session.
      const activeId = (user as any).activeSessionId;
      const tokenSession = payload.sessionId;
      const validSession = activeId ? tokenSession === activeId : !tokenSession;
      if (!allowStale && !validSession) {
        return next(new AppError("Sessiya boshqa qurilmada ochildi. Qayta kiring.", 401));
      }

    const isSuperAdmin = payload.role === "superAdmin";

    // A scheduled business-day hour change becomes active once its effective
    // moment passes. Promote it here — the one code path every authenticated
    // request goes through — so the DB, which both getEffectiveHour() and
    // GET /auth/me read from, ends up holding the hour the user actually chose.
    //
    // This previously cleared the pending fields WITHOUT copying the value into
    // businessDayStartHour, so every scheduled change was silently discarded
    // and the setting never took effect at all. A second block then rewrote
    // businessDayStartHour from the access token (valid for days) whenever the
    // two disagreed, which reverted any correct promotion and issued a write on
    // every single request. Both are replaced by the promotion below.
    let activeHour = (user as any).businessDayStartHour ?? payload.businessDayStartHour;
    let pendingHour: number | null = (user as any).pendingBusinessDayStartHour ?? null;
    const storedEffectiveFrom: Date | null = (user as any).businessDayEffectiveFrom ?? null;
    // AuthUser types this as an ISO string (that's what buildAuthUser puts in the
    // token); the raw mongoose value is a Date, so normalize instead of leaking
    // a Date through an `as any` the way this used to.
    let effectiveFrom: string | null = storedEffectiveFrom
      ? new Date(storedEffectiveFrom).toISOString()
      : null;

    if (pendingHour != null && storedEffectiveFrom && new Date() >= new Date(storedEffectiveFrom)) {
      const promoted = await authRepository.promoteBusinessDayHourIfDue(
        user._id.toString(),
        pendingHour,
        storedEffectiveFrom,
      );
      // A concurrent request may have promoted it first (promoted === null).
      // Either way the pending hour is the active one now, so use it locally
      // regardless of which request won the race.
      activeHour = promoted ? (promoted as any).businessDayStartHour : pendingHour;
      pendingHour = null;
      effectiveFrom = null;
    }

    req.auth = {
      userId: payload.userId,
      username: payload.username,
      phone_number: payload.phone_number,
      role: payload.role,
      isPayed: payload.isPayed ?? isSuperAdmin,
      tier: payload.tier ?? (isSuperAdmin ? "pro" : "tekin"),
      subscriptionEndDate: payload.subscriptionEndDate ?? null,
      sessionId: payload.sessionId,
      // DB values are the source of truth for business-day settings; the token
      // only fills in for accounts predating the field.
      businessDayStartHour: activeHour,
      pendingBusinessDayStartHour: pendingHour,
      businessDayEffectiveFrom: effectiveFrom,
    };
    return next();
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }
    return next(new AppError("Invalid or expired token", 401));
    }
  };
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
